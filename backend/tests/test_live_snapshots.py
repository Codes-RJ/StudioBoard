import asyncio
import json
import time
from collections import OrderedDict
from types import SimpleNamespace
from unittest.mock import AsyncMock

import numpy as np
import pandas as pd
import pytest
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.api.v1 import analytics
from app.core.config import settings
from app.core.redis_client import redis_client
from app.services import dataset_service as snapshots
from app.services.analytics.data_loader import convert_numpy_types


def strict_json(value):
    def reject_constant(token):
        raise ValueError(f"Invalid JSON constant: {token}")

    return json.loads(value, parse_constant=reject_constant)


@pytest.fixture
def snapshot_service(tmp_path, monkeypatch):
    path = tmp_path / "missing.csv"
    path.write_text("category,value\na,1\nb,\nc,inf\n", encoding="utf-8")
    dataset = SimpleNamespace(
        id="live-fixture", name="Missing values", description=None,
        filePath=str(path), rowCount=3,
    )
    monkeypatch.setattr(snapshots, "SNAPSHOT_CACHE", OrderedDict())
    monkeypatch.setattr(snapshots, "SNAPSHOT_LOCKS", tuple(asyncio.Lock() for _ in range(64)))
    monkeypatch.setattr(redis_client, "get_json", AsyncMock(return_value=None))
    monkeypatch.setattr(redis_client, "set_json", AsyncMock())
    return snapshots.DatasetService(None, None), dataset


@pytest.mark.parametrize("cache", ["fresh", "memory", "redis"])
async def test_all_snapshot_paths_are_strict_json(snapshot_service, cache):
    service, dataset = snapshot_service
    legacy = service._build_live_snapshot(dataset, time.perf_counter())
    # Simulate entries written by older processes, before normalization.
    legacy["metrics"]["primaryMean"] = float("inf")
    legacy["sample"]["rows"][1]["value"] = float("nan")
    if cache == "memory":
        snapshots.SNAPSHOT_CACHE[dataset.id] = {"cached_at": time.time(), "snapshot": legacy}
    elif cache == "redis":
        redis_client.get_json.return_value = legacy

    result = await service.get_live_snapshot(dataset)
    parsed = strict_json(JSONResponse(jsonable_encoder(result)).body)
    assert parsed["metrics"]["primaryMean"] is None
    assert [row["value"] for row in parsed["sample"]["rows"]] == [1, None, None]
    if cache != "fresh":
        # Cache presentation must not modify the shared object.
        assert np.isnan(legacy["sample"]["rows"][1]["value"])


async def test_snapshot_http_response_with_missing_and_infinite_values(client, tmp_path, monkeypatch, snapshot_service):
    monkeypatch.setattr(settings, "UPLOAD_PATH", str(tmp_path / "uploads"))
    upload = await client.post(
        "/api/datasets/upload",
        files={"file": ("missing.csv", b"category,value\na,1\nb,\nc,inf\n", "text/csv")},
        data={"name": "Missing values"},
    )
    assert upload.status_code == 201
    response = await client.get(f"/api/analytics/live/{upload.json()['id']}/snapshot")
    assert response.status_code == 200
    parsed = strict_json(response.content)
    assert parsed["metrics"]["primaryMean"] is None
    assert [row["value"] for row in parsed["sample"]["rows"]] == [1, None, None]


async def test_snapshot_sse_uses_strict_json(snapshot_service, monkeypatch):
    service, dataset = snapshot_service
    semaphore = asyncio.Semaphore(1)
    monkeypatch.setattr(analytics, "live_connection_limiter", semaphore)
    response = await analytics.stream_live_analytics(
        dataset.id,
        SimpleNamespace(is_disconnected=AsyncMock(return_value=False)),
        SimpleNamespace(id="owner", role="USER"),
        SimpleNamespace(get_accessible_dataset=AsyncMock(return_value=dataset)),
        service,
    )
    try:
        assert "event: ready" in await anext(response.body_iterator)
        event = await anext(response.body_iterator)
        assert "event: snapshot" in event
        parsed = strict_json(event.split("data: ", 1)[1].strip())
        assert parsed["metrics"]["primaryMean"] is None
        assert [row["value"] for row in parsed["sample"]["rows"]] == [1, None, None]
    finally:
        await response.body_iterator.aclose()
    assert semaphore._value == 1


def test_snapshot_normalizer_handles_nested_pandas_missing_values():
    result = convert_numpy_types({
        "date": pd.NaT, "timestamp": pd.Timestamp("2026-10-09"),
        "rows": [{"missing": pd.NA, "values": np.array([1, np.nan, np.inf, -np.inf])}],
    })
    assert strict_json(json.dumps(result, allow_nan=False)) == {
        "date": None, "timestamp": "2026-10-09T00:00:00",
        "rows": [{"missing": None, "values": [1, None, None, None]}],
    }

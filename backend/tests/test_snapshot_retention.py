import asyncio
import json
import time
from collections import OrderedDict
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from app.core.redis_client import redis_client
from app.services import dataset_service as snapshots


@pytest.fixture
def service(monkeypatch):
    monkeypatch.setattr(snapshots, "SNAPSHOT_CACHE", OrderedDict())
    locks = tuple(asyncio.Lock() for _ in range(64)) if isinstance(snapshots.SNAPSHOT_LOCKS, tuple) else {}
    monkeypatch.setattr(snapshots, "SNAPSHOT_LOCKS", locks)
    monkeypatch.setattr(settings, "LIVE_SNAPSHOT_CACHE_MAX_ENTRIES", 3, raising=False)
    monkeypatch.setattr(settings, "LIVE_SNAPSHOT_CACHE_MAX_BYTES", 1024, raising=False)
    monkeypatch.setattr(redis_client, "get_json", AsyncMock(return_value=None))
    monkeypatch.setattr(redis_client, "set_json", AsyncMock())
    monkeypatch.setattr(redis_client, "delete", AsyncMock())
    monkeypatch.setattr(snapshots.DatasetService, "_build_live_snapshot", staticmethod(
        lambda dataset, started: {"datasetId": dataset.id, "sample": {"rows": [{"value": getattr(dataset, "value", 1)}]}}
    ))
    return snapshots.DatasetService(None, None)


async def test_snapshot_cache_and_locks_remain_bounded(service):
    for index in range(100):
        await service.get_live_snapshot(SimpleNamespace(id=f"retention-{index}"))
    assert len(snapshots.SNAPSHOT_CACHE) <= 3
    assert len(snapshots.SNAPSHOT_LOCKS) <= 64


async def test_snapshot_cache_evicts_least_recently_used_and_expired_entries(service):
    for key in ["a", "b", "c", "a", "d"]:
        await service.get_live_snapshot(SimpleNamespace(id=key))
    assert list(snapshots.SNAPSHOT_CACHE) == ["c", "a", "d"]
    snapshots.SNAPSHOT_CACHE["c"]["cached_at"] = time.time() - 60
    await service.get_live_snapshot(SimpleNamespace(id="a"))
    assert "c" not in snapshots.SNAPSHOT_CACHE


async def test_cache_respects_total_byte_budget_and_skips_large_entries(service):
    for index in range(10):
        await service.get_live_snapshot(SimpleNamespace(id=f"bytes-{index}", value="x" * 450))
    retained_bytes = sum(len(json.dumps(entry["snapshot"], separators=(",", ":"), allow_nan=False).encode()) for entry in snapshots.SNAPSHOT_CACHE.values())
    assert retained_bytes <= 1024
    await service.get_live_snapshot(SimpleNamespace(id="oversized", value="x" * 2048))
    assert "oversized" not in snapshots.SNAPSHOT_CACHE


async def test_delete_waits_for_active_build_and_clears_its_result(service, monkeypatch, tmp_path):
    path = tmp_path / "owned.csv"; path.write_text("value\n1\n", encoding="utf-8")
    dataset = SimpleNamespace(id="delete-active", filePath=str(path), name="Fixture")
    service.dataset_repo = SimpleNamespace(
        get_accessible_dataset=AsyncMock(return_value=dataset), delete=AsyncMock(),
        session=SimpleNamespace(commit=AsyncMock()),
    )
    service.audit_repo = SimpleNamespace(log_action=AsyncMock())
    started = asyncio.Event(); finish = asyncio.Event(); order = []

    async def build(*args):
        started.set(); await finish.wait()
        return {"datasetId": dataset.id, "sample": {"rows": []}}

    async def record_set(*args, **kwargs): order.append("set")
    async def record_delete(*args, **kwargs): order.append("delete")
    monkeypatch.setattr(snapshots.analytics_engine, "execute_blocking_task", build)
    redis_client.set_json.side_effect = record_set
    redis_client.delete.side_effect = record_delete
    active = asyncio.create_task(service.get_live_snapshot(dataset))
    await started.wait()
    deleting = asyncio.create_task(service.delete_dataset(dataset.id, SimpleNamespace(id="owner", role="USER")))
    try:
        await asyncio.sleep(0.05)
    finally:
        finish.set()
        await asyncio.gather(active, deleting)
    assert dataset.id not in snapshots.SNAPSHOT_CACHE
    assert order == ["set", "delete"]


async def test_same_dataset_concurrent_reads_share_one_build(service, monkeypatch):
    calls = 0
    async def build(*args):
        nonlocal calls
        calls += 1; await asyncio.sleep(0)
        return {"datasetId": "shared"}
    monkeypatch.setattr(snapshots.analytics_engine, "execute_blocking_task", build)
    await asyncio.gather(*(service.get_live_snapshot(SimpleNamespace(id="shared")) for _ in range(20)))
    assert calls == 1


async def test_disabled_cache_retains_no_entries(service, monkeypatch):
    await service.get_live_snapshot(SimpleNamespace(id="old"))
    monkeypatch.setattr(settings, "LIVE_SNAPSHOT_CACHE_MAX_ENTRIES", 0)
    await service.get_live_snapshot(SimpleNamespace(id="new"))
    assert not snapshots.SNAPSHOT_CACHE


async def test_cancelled_waiter_keeps_the_active_lock(service, monkeypatch):
    started = asyncio.Event(); finish = asyncio.Event()
    async def build(*args):
        started.set(); await finish.wait()
        return {"datasetId": "cancelled-waiter"}
    monkeypatch.setattr(snapshots.analytics_engine, "execute_blocking_task", build)
    dataset = SimpleNamespace(id="cancelled-waiter")
    lock = snapshots._snapshot_lock(dataset.id)
    owner = asyncio.create_task(service.get_live_snapshot(dataset))
    await started.wait()
    waiter = asyncio.create_task(service.get_live_snapshot(dataset))
    await asyncio.sleep(0); waiter.cancel()
    with pytest.raises(asyncio.CancelledError): await waiter
    assert snapshots._snapshot_lock(dataset.id) is lock
    assert lock.locked()
    finish.set(); await owner
    assert not lock.locked()

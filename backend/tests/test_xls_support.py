from pathlib import Path

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.services.analytics.data_loader import load_dataframe


WORKBOOK = Path(__file__).parent / "fixtures" / "legacy-biff8.xls"


def test_real_biff8_workbook_loads():
    frame = load_dataframe(str(WORKBOOK))
    assert frame.to_dict(orient="records") == [
        {"identifier": "A001", "value": 10}, {"identifier": "A002", "value": 20},
    ]


async def test_real_xls_upload_and_analytics(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_PATH", str(tmp_path / "uploads"))
    response = await client.post("/api/datasets/upload", files={
        "file": ("legacy.xls", WORKBOOK.read_bytes(), "application/vnd.ms-excel"),
    })
    assert response.status_code == 201
    dataset = response.json()
    assert dataset["rowCount"] == 2
    result = await client.post("/api/analytics/descriptive", json={"datasetId": dataset["id"], "columns": ["value"]})
    assert result.status_code == 200
    assert result.json()["value"]["mean"] == 15


def test_corrupt_xls_returns_useful_error(tmp_path):
    path = tmp_path / "broken.xls"
    path.write_bytes(bytes.fromhex("d0cf11e0a1b11ae1") + b"invalid workbook")
    with pytest.raises(HTTPException, match="Unable to load the dataset") as error:
        load_dataframe(str(path))
    assert error.value.status_code == 400


async def test_corrupt_xls_upload_does_not_leave_files(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_PATH", str(tmp_path))
    response = await client.post("/api/datasets/upload", files={
        "file": ("broken.xls", bytes.fromhex("d0cf11e0a1b11ae1") + b"invalid workbook", "application/vnd.ms-excel"),
    })
    assert response.status_code == 400
    assert not list(tmp_path.glob("*.xls"))
    assert not list(tmp_path.glob("*.part"))

import pandas as pd
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.domain.schemas import RegressionRequest
from app.services.analytics.strategies.regression import LinearRegressionStrategy


def test_same_field_regression_request_is_rejected():
    with pytest.raises(ValidationError, match="different columns"):
        RegressionRequest(datasetId="fixture", x="value", y="value")


async def test_same_field_regression_strategy_is_rejected():
    with pytest.raises(HTTPException, match="different columns") as error:
        await LinearRegressionStrategy().execute(pd.DataFrame({"value": [1, 2, 3]}), {"x": "value", "y": "value"})
    assert error.value.status_code == 400


async def test_same_field_regression_http_returns_validation_error(client):
    response = await client.post("/api/analytics/regression", json={"datasetId": "fixture", "x": "value", "y": "value"})
    assert response.status_code == 422
    assert "different columns" in response.text


async def test_same_field_regression_job_returns_validation_error(client, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "UPLOAD_PATH", str(tmp_path / "uploads"))
    upload = await client.post("/api/datasets/upload", files={"file": ("regression.csv", b"value\n1\n2\n3\n", "text/csv")})
    assert upload.status_code == 201
    response = await client.post("/api/analytics/jobs", json={
        "datasetId": upload.json()["id"], "strategy": "regression",
        "parameters": {"x": "value", "y": "value"},
    })
    assert response.status_code == 422
    assert "different columns" in response.text


async def test_distinct_regression_columns_with_equal_values_remain_valid():
    frame = pd.DataFrame({"x": [1, 2, None, 3], "y": [1, 2, 9, 3]})
    result = await LinearRegressionStrategy().execute(frame, {"x": "x", "y": "y"})
    assert result["coefficient"] == pytest.approx(1)
    assert result["intercept"] == pytest.approx(0)
    assert result["n_observations"] == 3

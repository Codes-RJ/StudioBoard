import pandas as pd
import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from app.services.analytics.strategies.correlation import CorrelationStrategy
from app.services.analytics.strategies.pivot import PivotTableStrategy
from app.services.result_limits import enforce_export_limit, enforce_interactive_result_limit
from app.core.config import settings


@pytest.mark.asyncio
async def test_analytics_routes_reject_unknown_or_invalid_parameters(client: AsyncClient):
    invalid_method = await client.post(
        "/api/analytics/correlation",
        json={"datasetId": "dataset", "method": "invalid"},
    )
    assert invalid_method.status_code == 422

    unexpected_parameter = await client.post(
        "/api/analytics/descriptive",
        json={"datasetId": "dataset", "file_path": "C:/sensitive-path.csv"},
    )
    assert unexpected_parameter.status_code == 422


@pytest.mark.asyncio
async def test_correlation_and_pivot_have_result_size_guards():
    correlation_df = pd.DataFrame({f"metric_{index}": [index, index + 1] for index in range(101)})
    with pytest.raises(HTTPException, match="100 numeric columns"):
        await CorrelationStrategy().execute(correlation_df, {})

    pivot_df = pd.DataFrame({
        "group": [f"g{index}" for index in range(101)],
        "segment": [f"s{index % 100}" for index in range(101)],
        "value": list(range(101)),
    })
    # All 101 x 100 category combinations are represented by the declared
    # cardinality, so the strategy must reject the potential result before
    # materializing a large table.
    pivot_df = pd.concat([pivot_df.assign(segment=f"s{segment}") for segment in range(100)], ignore_index=True)
    with pytest.raises(HTTPException, match="10,000-cell limit"):
        await PivotTableStrategy().execute(
            pivot_df,
            {"index": "group", "columns": "segment", "values": "value", "aggfunc": "sum"},
        )


def test_global_result_and_export_budgets_return_typed_errors(monkeypatch):
    monkeypatch.setattr(settings, "ANALYTICS_MAX_RESPONSE_BYTES", 64 * 1024)
    with pytest.raises(HTTPException) as result_error:
        enforce_interactive_result_limit({"rows": ["x" * 1024] * 65})

    assert result_error.value.status_code == 413
    assert result_error.value.detail["code"] == "RESULT_TOO_LARGE"
    assert "background job" in result_error.value.detail["recommendation"]

    monkeypatch.setattr(settings, "INTERACTIVE_EXPORT_MAX_BYTES", 64 * 1024)
    with pytest.raises(HTTPException) as export_error:
        enforce_export_limit(65 * 1024, background=False)

    assert export_error.value.status_code == 413
    assert export_error.value.detail["code"] == "EXPORT_TOO_LARGE"

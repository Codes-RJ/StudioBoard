import csv
import json
from pathlib import Path

import pandas as pd
import pytest

from app.services.analytics.data_loader import load_dataframe
from app.services.analytics.engine import analytics_engine
from app.services.analytics.strategies.correlation import CorrelationStrategy
from app.services.analytics.strategies.outliers import OutlierDetectionStrategy
from app.services.analytics.strategies.statistics import DescriptiveStatsStrategy


CONTRACTS = json.loads((Path(__file__).parents[2] / "fixtures/analytics-contracts.v1.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("fixture", CONTRACTS["metrics"], ids=lambda fixture: fixture["id"])
async def test_shared_metric_inputs_through_file_loader_and_server_statistics(fixture, tmp_path):
    path = tmp_path / "metric.csv"
    # Keep wholly missing CSV records: pandas' default blank-line skipping
    # differs from browser import, so use a second populated row-id column.
    with path.open("w", newline="", encoding="utf-8") as output:
        writer = csv.writer(output); writer.writerow(["sourceRow", "value"])
        writer.writerows(enumerate(fixture["values"]))
    result = await analytics_engine.execute_strategy("statistics", str(path), {"columns": ["value"]})
    metric = result["value"]
    assert metric["count"] == fixture["expected"]["count"]
    assert metric["missing"] == fixture["expected"]["missing"]
    expected = fixture.get("serverApproximation", {
        "mean": fixture["expected"]["average"], "min": fixture["expected"]["min"], "max": fixture["expected"]["max"],
    })
    for operation, value in expected.items():
        if value is None: assert metric[operation] is None
        else: assert metric[operation] == pytest.approx(value, rel=1e-15, abs=1e-12)
    if fixture["id"] == "reviewed-unsafe-integers":
        assert isinstance(metric["mean"], float)
        assert metric["mean"] != int(fixture["values"][0])
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("fixture", CONTRACTS["correlations"], ids=lambda fixture: fixture["id"])
async def test_shared_pairwise_finite_correlation(fixture):
    frame = pd.DataFrame(fixture["pairs"], columns=["a", "b"]).apply(pd.to_numeric, errors="coerce")
    result = await CorrelationStrategy().execute(frame, {"columns": ["a", "b"]})
    value = result["a"]["b"]
    if fixture["value"] is None: assert value is None
    else: assert value == pytest.approx(fixture["value"], abs=1e-12)
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("method", ["iqr", "zscore"])
async def test_shared_outlier_source_labels(method):
    fixture = CONTRACTS["outliers"]
    frame = pd.DataFrame({"value": fixture["values"]}, index=fixture["sourceRows"])
    result = await OutlierDetectionStrategy().execute(frame, {"column": "value", "method": method})
    assert result["outlier_indices"] == fixture["outlierSourceRows"]
    assert result["outliers"] == fixture["outlierValues"]


async def test_shared_filters_preserve_source_identity_and_document_numeric_difference(tmp_path):
    fixture = CONTRACTS["filtering"]
    path = tmp_path / "filters.csv"; pd.DataFrame(fixture["rows"]).to_csv(path, index=False)
    for key, expected in [("textFilter", "textSourceRows"), ("numericFilter", "serverNumericSourceRows")]:
        result = await analytics_engine.get_paginated_data(str(path), filters=fixture[key])
        assert [row["sourceRow"] for row in result["data"]] == fixture[expected]
    # Use the preserved DataFrame labels to analyze the identical text scope.
    frame = load_dataframe(str(path))
    selected = frame.loc[frame["sourceRow"].isin(fixture["textSourceRows"])]
    metric = await DescriptiveStatsStrategy().execute(selected, {"columns": ["value"]})
    assert metric["value"]["mean"] == 11

import pandas as pd
import pytest

from app.services.analytics.strategies.timeseries import TimeSeriesStrategy


@pytest.mark.parametrize("values,expected", [
    ([-10, -5, -1], "increasing"),
    ([-1, -5, -10], "decreasing"),
    ([-1, 0, 1], "increasing"),
    ([0, -1, -2], "decreasing"),
    ([-3, None, -1], "increasing"),
    ([-1, None, -3], "decreasing"),
    ([0, None, 0], "stable"),
    ([-1, None, -1], "stable"),
])
async def test_trends_include_observed_nonpositive_means(values, expected):
    frame = pd.DataFrame({"date": ["2026-01-01", "2026-02-01", "2026-03-01"], "value": values})
    result = await TimeSeriesStrategy().execute(frame, {"date_col": "date", "value_col": "value", "freq": "ME"})
    assert result["trend"] == expected
    assert result["total_periods"] == 3
    assert [period["count"] for period in result["data"]] == [1, int(values[1] is not None), 1]


async def test_zero_mean_is_observed_and_empty_period_is_not(tmp_path):
    from app.services.analytics.engine import analytics_engine

    path = tmp_path / "trend.csv"
    path.write_text("date,value\n2026-01-01,-1\n2026-01-02,1\n2026-03-01,-2\n", encoding="utf-8")
    result = await analytics_engine.execute_strategy("timeseries", str(path), {"date_col": "date", "value_col": "value"})
    assert result["trend"] == "decreasing"
    assert [(period["mean"], period["count"]) for period in result["data"]] == [(0, 2), (0, 0), (-2, 1)]

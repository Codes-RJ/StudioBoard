import pandas as pd
import pytest

from app.services.analytics.strategies.outliers import OutlierDetectionStrategy


@pytest.mark.parametrize("method", ["zscore", "iqr"])
@pytest.mark.parametrize("index", [list(range(12)), [7, 10, 13, 20, 28, 31, 45, 60, 71, 82, 90, 101]])
async def test_outliers_use_source_index_after_missing_values(method, index):
    frame = pd.DataFrame({"value": [None] + [0] * 10 + [100]}, index=index)
    result = await OutlierDetectionStrategy().execute(frame, {"column": "value", "method": method})
    assert result["total_rows"] == 11
    assert result["outliers"] == [100]
    assert result["outlier_indices"] == [index[-1]]
    assert frame.loc[result["outlier_indices"], "value"].tolist() == result["outliers"]


async def test_outlier_engine_preserves_original_file_row_positions(tmp_path):
    from app.services.analytics.engine import analytics_engine

    path = tmp_path / "outliers.csv"
    path.write_text("value\nmissing\n" + "0\n" * 10 + "100\n", encoding="utf-8")
    result = await analytics_engine.execute_strategy("outliers", str(path), {"column": "value", "method": "zscore"})
    assert result["outlier_indices"] == [11]

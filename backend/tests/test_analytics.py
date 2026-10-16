import pytest
import os
import tempfile
import pandas as pd
from app.services.analytics.engine import analytics_engine


@pytest.fixture
def sample_csv_file():
    fd, path = tempfile.mkstemp(suffix=".csv")
    df = pd.DataFrame({
        "category": ["A", "B", "A", "C", "B", "A"],
        "value": [10.0, 20.0, 15.0, 30.0, 25.0, 12.0],
        "score": [100, 200, 150, 300, 250, 120]
    })
    df.to_csv(path, index=False)
    yield path
    os.close(fd)
    if os.path.exists(path):
        os.remove(path)


@pytest.mark.asyncio
async def test_descriptive_stats(sample_csv_file):
    stats = await analytics_engine.execute_strategy("statistics", sample_csv_file, {})
    assert "value" in stats
    assert stats["value"]["count"] == 6
    assert stats["value"]["mean"] == pytest.approx(18.6666, 0.01)
    assert "category" in stats
    assert stats["category"]["unique_values"] == 3


@pytest.mark.asyncio
async def test_correlation(sample_csv_file):
    corr = await analytics_engine.execute_strategy("correlation", sample_csv_file, {})
    assert "value" in corr
    assert "score" in corr["value"]
    assert corr["value"]["score"] == pytest.approx(1.0, 0.01)


@pytest.mark.asyncio
async def test_regression(sample_csv_file):
    reg = await analytics_engine.execute_strategy("regression", sample_csv_file, {"x": "value", "y": "score"})
    assert reg["coefficient"] == pytest.approx(10.0, 0.01)
    assert reg["r2_score"] == pytest.approx(1.0, 0.01)


@pytest.mark.asyncio
async def test_outliers(sample_csv_file):
    outliers = await analytics_engine.execute_strategy("outliers", sample_csv_file, {"column": "value", "method": "iqr"})
    assert outliers["total_rows"] == 6
    assert isinstance(outliers["outliers"], list)


@pytest.mark.asyncio
async def test_missing_with_nan_handling():
    fd, path = tempfile.mkstemp(suffix=".csv")
    df = pd.DataFrame({
        "all_nan": [None, None, None],
        "some_nan": [1.0, None, 3.0]
    })
    df.to_csv(path, index=False)

    try:
        # Test mode strategy does not throw IndexError on all-NaN column
        missing_res = await analytics_engine.execute_strategy("missing", path, {"strategy": "mode"})
        assert missing_res["rows_before"] == 3
    finally:
        os.close(fd)
        if os.path.exists(path):
            os.remove(path)

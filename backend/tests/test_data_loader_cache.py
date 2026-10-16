import pandas as pd

from app.services.analytics.data_loader import invalidate_dataframe_cache, load_dataframe


def test_dataframe_cache_refreshes_when_a_file_changes(tmp_path):
    dataset_path = tmp_path / "cache.csv"
    pd.DataFrame({"value": [1, 2]}).to_csv(dataset_path, index=False)

    first = load_dataframe(str(dataset_path))
    assert len(first) == 2

    pd.DataFrame({"value": [1, 2, 3]}).to_csv(dataset_path, index=False)
    refreshed = load_dataframe(str(dataset_path))
    assert len(refreshed) == 3

    invalidate_dataframe_cache(str(dataset_path))

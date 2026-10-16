import logging
import os
import threading
from collections import OrderedDict
from datetime import datetime
from typing import Any, List, Optional
import numpy as np
import pandas as pd
from fastapi import HTTPException
from app.core.config import settings
from app.services.analytics.archive_policy import validate_workbook_archive

CSV_ENCODINGS = ("utf-8", "utf-8-sig", "cp1252", "latin1")
logger = logging.getLogger(__name__)
DATAFRAME_CACHE: OrderedDict[str, tuple[int, int, pd.DataFrame]] = OrderedDict()
DATAFRAME_CACHE_LOCK = threading.RLock()


def _is_missing_scalar(value: Any) -> bool:
    if value is None:
        return True
    try:
        missing = pd.isna(value)
        return bool(missing) if isinstance(missing, (bool, np.bool_)) else False
    except Exception:
        return False


def convert_numpy_types(obj: Any) -> Any:
    """
    Recursively converts pandas/numpy values (NaN, Inf, int64, float64, Timestamps)
    to JSON-safe standard Python types.
    """
    if isinstance(obj, dict):
        return {str(k): convert_numpy_types(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [convert_numpy_types(v) for v in obj]
    if isinstance(obj, pd.DataFrame):
        return convert_numpy_types(obj.to_dict(orient="records"))
    if isinstance(obj, pd.Series):
        return convert_numpy_types(obj.to_dict())
    if isinstance(obj, (pd.Index, np.ndarray)):
        return convert_numpy_types(obj.tolist())
    if _is_missing_scalar(obj):
        return None
    if isinstance(obj, (pd.Timestamp, datetime)):
        return obj.isoformat()
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        val = float(obj)
        return val if np.isfinite(val) else None
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    return obj


def load_csv_dataframe(file_path: str) -> pd.DataFrame:
    last_error = None
    for encoding in CSV_ENCODINGS:
        try:
            return pd.read_csv(file_path, encoding=encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
        except Exception as error:
            logger.info("CSV parsing failed", exc_info=error)
            raise HTTPException(status_code=400, detail="Unable to parse the CSV file") from error

    raise HTTPException(
        status_code=400,
        detail=f"Unable to decode CSV file. Supported encodings: {', '.join(CSV_ENCODINGS)}"
    )


def invalidate_dataframe_cache(file_path: str) -> None:
    """Remove an uploaded dataset from the bounded parsed-data cache."""
    with DATAFRAME_CACHE_LOCK:
        DATAFRAME_CACHE.pop(os.path.abspath(file_path), None)


def _read_dataframe(file_path: str) -> pd.DataFrame:
    """
    Loads DataFrame from file path based on extension with automatic encoding fallback.
    """
    ext = os.path.splitext(file_path)[1].lower()
    try:
        if ext == ".csv":
            return load_csv_dataframe(file_path)
        elif ext in (".xlsx", ".xls"):
            if ext == ".xlsx":
                validate_workbook_archive(file_path)
            return pd.read_excel(file_path)
        elif ext == ".parquet":
            return pd.read_parquet(file_path)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file format: {ext}")
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Dataset loading failed")
        raise HTTPException(status_code=400, detail="Unable to load the dataset") from error


def load_dataframe(file_path: str) -> pd.DataFrame:
    """Load a dataset, reusing only small, unchanged files in a bounded cache.

    Callers must treat returned frames as immutable. The analytics strategies
    derive filtered/copy data before transformations, so a shallow copy is
    enough to isolate DataFrame metadata while avoiding duplicate large arrays.
    """
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dataset file not found")

    absolute_path = os.path.abspath(file_path)
    stat = os.stat(absolute_path)
    fingerprint = (stat.st_mtime_ns, stat.st_size)
    cacheable = (
        settings.DATAFRAME_CACHE_MAX_ENTRIES > 0
        and stat.st_size <= settings.DATAFRAME_CACHE_MAX_FILE_BYTES
    )

    if cacheable:
        with DATAFRAME_CACHE_LOCK:
            cached = DATAFRAME_CACHE.get(absolute_path)
            if cached and cached[:2] == fingerprint:
                DATAFRAME_CACHE.move_to_end(absolute_path)
                return cached[2].copy(deep=False)
            DATAFRAME_CACHE.pop(absolute_path, None)

    dataframe = _read_dataframe(absolute_path)
    if not cacheable:
        return dataframe

    with DATAFRAME_CACHE_LOCK:
        DATAFRAME_CACHE[absolute_path] = (fingerprint[0], fingerprint[1], dataframe)
        DATAFRAME_CACHE.move_to_end(absolute_path)
        while len(DATAFRAME_CACHE) > settings.DATAFRAME_CACHE_MAX_ENTRIES:
            DATAFRAME_CACHE.popitem(last=False)
    return dataframe.copy(deep=False)

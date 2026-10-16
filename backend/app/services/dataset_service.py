import os
import uuid
import time
import io
import asyncio
import datetime
import hashlib
from copy import deepcopy
import logging
import zipfile
import json
from collections import OrderedDict
from pathlib import Path
from typing import Dict, Any, List, Optional
import pandas as pd
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings
from app.core.storage_leases import storage_account_lease, storage_artifact_lease
from app.domain.models import Dataset, User
from app.repositories.dataset_repository import DatasetRepository
from app.repositories.audit_repository import AuditLogRepository
from app.services.analytics.data_loader import convert_numpy_types, invalidate_dataframe_cache, load_dataframe
from app.services.analytics.engine import analytics_engine

# Memory cache for live snapshots
SNAPSHOT_CACHE: OrderedDict[str, Dict[str, Any]] = OrderedDict()
# Fixed stripes keep lock identity stable for active owners and waiters while
# avoiding one permanent lock per dataset. A collision only serializes work.
SNAPSHOT_LOCKS = tuple(asyncio.Lock() for _ in range(64))
CACHE_TTL_SECONDS = 15
UPLOAD_CHUNK_SIZE = 1024 * 1024
MAX_XLSX_ARCHIVE_MEMBERS = 2_000
MAX_XLSX_EXTRACTED_BYTES = 512 * 1024 * 1024
MAX_XLSX_COMPRESSION_RATIO = 100
logger = logging.getLogger(__name__)


def _snapshot_lock(dataset_id: str) -> asyncio.Lock:
    stripe = hashlib.sha256(dataset_id.encode("utf-8")).digest()[0] % len(SNAPSHOT_LOCKS)
    return SNAPSHOT_LOCKS[stripe]


def _prune_snapshot_cache(now: float) -> None:
    for dataset_id, entry in list(SNAPSHOT_CACHE.items()):
        if now - entry["cached_at"] >= CACHE_TTL_SECONDS:
            SNAPSHOT_CACHE.pop(dataset_id, None)
    retained_bytes = sum(entry.get("size_bytes", 0) for entry in SNAPSHOT_CACHE.values())
    while SNAPSHOT_CACHE and (
        len(SNAPSHOT_CACHE) > settings.LIVE_SNAPSHOT_CACHE_MAX_ENTRIES
        or retained_bytes > settings.LIVE_SNAPSHOT_CACHE_MAX_BYTES
    ):
        _, removed = SNAPSHOT_CACHE.popitem(last=False)
        retained_bytes -= removed.get("size_bytes", 0)


def _cache_snapshot(dataset_id: str, snapshot: Dict[str, Any]) -> None:
    now = time.time()
    size = len(json.dumps(snapshot, separators=(",", ":"), allow_nan=False).encode("utf-8"))
    if settings.LIVE_SNAPSHOT_CACHE_MAX_ENTRIES and size <= settings.LIVE_SNAPSHOT_CACHE_MAX_BYTES:
        SNAPSHOT_CACHE[dataset_id] = {"cached_at": now, "snapshot": snapshot, "size_bytes": size}
        SNAPSHOT_CACHE.move_to_end(dataset_id)
    _prune_snapshot_cache(now)


def resolve_upload_directory() -> str:
    path = settings.UPLOAD_PATH or "./uploads"
    if not os.path.isabs(path):
        path = os.path.abspath(path)
    os.makedirs(path, exist_ok=True)
    return path


# Magic bytes per supported format — extensions alone are client-controlled.
def _detect_file_signature(content: bytes, ext: str) -> bool:
    """Validates the declared extension against the file's real magic bytes."""
    if ext == ".csv":
        # Text heuristics: decodable UTF-8-ish and not a disguised binary.
        if b"\x00" in content[:4096]:
            return False
        try:
            content[:8192].decode("utf-8", errors="strict")
            return True
        except UnicodeDecodeError:
            try:
                content[:8192].decode("latin-1")
                return True
            except Exception:
                return False
    if ext == ".xlsx":  # ZIP container (OOXML)
        return content[:4] == b"PK\x03\x04"
    if ext == ".xls":  # legacy OLE2 compound document
        return content[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
    if ext == ".parquet":
        return content[:4] == b"PAR1" or content[-4:] == b"PAR1"
    return False


def _validate_xlsx_archive(content: bytes) -> None:
    """Reject malformed, encrypted, and highly-expanded XLSX archives before Pandas opens them."""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            if not entries or len(entries) > MAX_XLSX_ARCHIVE_MEMBERS:
                raise ValueError("unexpected archive member count")
            if "[Content_Types].xml" not in archive.namelist() or not any(name.startswith("xl/") for name in archive.namelist()):
                raise ValueError("not an XLSX workbook")
            extracted_size = sum(entry.file_size for entry in entries)
            if extracted_size > MAX_XLSX_EXTRACTED_BYTES:
                raise ValueError("workbook expands beyond the supported size")
            for entry in entries:
                if entry.flag_bits & 0x1:
                    raise ValueError("encrypted workbooks are not supported")
                if entry.compress_size and entry.file_size / entry.compress_size > MAX_XLSX_COMPRESSION_RATIO:
                    raise ValueError("workbook compression ratio is unsafe")
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        raise HTTPException(status_code=400, detail="Invalid or unsafe XLSX workbook") from error


def _detect_file_signature_from_path(file_path: str, ext: str) -> bool:
    """Validate signature bytes without retaining an uploaded file in memory."""
    with open(file_path, "rb") as uploaded_file:
        prefix = uploaded_file.read(8192)
        uploaded_file.seek(0, os.SEEK_END)
        suffix = b""
        if uploaded_file.tell() >= 4:
            uploaded_file.seek(-4, os.SEEK_END)
            suffix = uploaded_file.read(4)

    if ext == ".csv":
        if b"\x00" in prefix[:4096]:
            return False
        try:
            prefix.decode("utf-8", errors="strict")
            return True
        except UnicodeDecodeError:
            return True  # Latin-1 accepts all byte sequences.
    if ext == ".xlsx":
        return prefix[:4] == b"PK\x03\x04"
    if ext == ".xls":
        return prefix[:8] == bytes.fromhex("D0CF11E0A1B11AE1")
    if ext == ".parquet":
        return prefix[:4] == b"PAR1" and suffix == b"PAR1"
    return False


def _validate_xlsx_archive_from_path(file_path: str) -> None:
    """Reject unsafe XLSX archives stored in upload quarantine."""
    try:
        with zipfile.ZipFile(file_path) as archive:
            entries = archive.infolist()
            if not entries or len(entries) > MAX_XLSX_ARCHIVE_MEMBERS:
                raise ValueError("unexpected archive member count")
            if "[Content_Types].xml" not in archive.namelist() or not any(name.startswith("xl/") for name in archive.namelist()):
                raise ValueError("not an XLSX workbook")
            extracted_size = sum(entry.file_size for entry in entries)
            if extracted_size > MAX_XLSX_EXTRACTED_BYTES:
                raise ValueError("workbook expands beyond the supported size")
            for entry in entries:
                if entry.flag_bits & 0x1:
                    raise ValueError("encrypted workbooks are not supported")
                if entry.compress_size and entry.file_size / entry.compress_size > MAX_XLSX_COMPRESSION_RATIO:
                    raise ValueError("workbook compression ratio is unsafe")
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        raise HTTPException(status_code=400, detail="Invalid or unsafe XLSX workbook") from error


async def _stream_upload_to_file(file: UploadFile, target_path: str) -> tuple[int, str]:
    """Write an upload in bounded chunks and return its size and SHA-256."""
    file_size = 0
    digest = hashlib.sha256()
    with open(target_path, "wb") as destination:
        while True:
            chunk = await file.read(UPLOAD_CHUNK_SIZE)
            if not chunk:
                break
            file_size += len(chunk)
            if file_size > settings.UPLOAD_MAX_SIZE:
                raise HTTPException(
                    status_code=400,
                    detail=f"File exceeds maximum upload size of {settings.UPLOAD_MAX_SIZE / 1024 / 1024} MB"
                )
            digest.update(chunk)
            destination.write(chunk)
    return file_size, digest.hexdigest()


async def _stream_validate_and_promote_upload(
    file: UploadFile,
    temporary_path: str,
    target_path: str,
    ext: str,
    remaining_bytes: float,
    is_admin: bool,
) -> tuple[int, str]:
    """Quarantine, validate, and atomically promote an uploaded dataset."""
    try:
        file_size, checksum = await _stream_upload_to_file(file, temporary_path)
        if not _detect_file_signature_from_path(temporary_path, ext):
            raise HTTPException(status_code=400, detail="File content does not match its extension. Upload rejected.")
        if ext == ".xlsx":
            _validate_xlsx_archive_from_path(temporary_path)
        if not is_admin and file_size > remaining_bytes:
            raise HTTPException(status_code=400, detail="File exceeds your remaining storage quota")
        os.replace(temporary_path, target_path)
        return file_size, checksum
    except BaseException:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)
        raise


def calculate_storage_metrics(file_paths: List[str], is_admin: bool = False) -> Dict[str, Any]:
    total_bytes = 0
    valid_count = 0

    for path in file_paths:
        if path and os.path.exists(path):
            total_bytes += os.path.getsize(path)
            valid_count += 1

    quota_bytes = 0 if is_admin else settings.USER_STORAGE_QUOTA_MB * 1024 * 1024
    remaining_bytes = max(0, quota_bytes - total_bytes) if quota_bytes > 0 else float("inf")
    usage_percent = round((total_bytes / quota_bytes) * 100, 1) if quota_bytes > 0 else 0.0

    return {
        "usedBytes": total_bytes,
        "quotaBytes": quota_bytes,
        "remainingBytes": 999999999999 if is_admin else remaining_bytes,
        "usagePercent": usage_percent,
        "datasetCount": valid_count,
        "datasetLimit": 999999 if is_admin else settings.USER_DATASET_LIMIT,
        "maxUploadSizeBytes": settings.UPLOAD_MAX_SIZE
    }


class DatasetService:
    def __init__(self, dataset_repo: DatasetRepository, audit_repo: AuditLogRepository):
        self.dataset_repo = dataset_repo
        self.audit_repo = audit_repo

    async def get_user_storage(self, user: User, *, current: bool = False) -> Dict[str, Any]:
        paths = await self.dataset_repo.get_all_user_filepaths(user.id, current=current)
        return calculate_storage_metrics(paths, is_admin=(user.role == "ADMIN"))

    async def upload_dataset(
        self,
        user: User,
        file: UploadFile,
        name: Optional[str] = None,
        description: Optional[str] = None
    ) -> Dataset:
        # Save file to disk
        upload_dir = resolve_upload_directory()
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in (".csv", ".xlsx", ".xls", ".parquet"):
            raise HTTPException(status_code=400, detail="Unsupported file format. Use CSV, XLSX, XLS, or Parquet.")

        unique_filename = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}{ext}"
        target_path = os.path.join(upload_dir, unique_filename)

        # Admit against current committed usage only after acquiring the
        # account's shared-volume lease. Hold admission until commit settles.
        async with storage_account_lease(Path(upload_dir), user.id):
            storage = await self.get_user_storage(user, current=True)
            if user.role != "ADMIN" and storage["datasetCount"] >= storage["datasetLimit"]:
                raise HTTPException(status_code=400, detail="Dataset limit reached for this account")
            # Separate artifact stripes protect staging/promotion from cleanup.
            async with storage_artifact_lease(Path(upload_dir), Path(target_path)):
                return await self._accept_upload(user, file, name, description, target_path, ext, storage)

    async def _accept_upload(
        self, user: User, file: UploadFile, name: Optional[str], description: Optional[str],
        target_path: str, ext: str, storage: Dict[str, Any],
    ) -> Dataset:
        unique_filename = os.path.basename(target_path)
        file_size, checksum = await _stream_validate_and_promote_upload(
            file=file,
            temporary_path=f"{target_path}.part",
            target_path=target_path,
            ext=ext,
            remaining_bytes=storage["remainingBytes"],
            is_admin=(user.role == "ADMIN"),
        )

        # Size, signature, archive and quota checks precede atomic promotion.
        committed = False
        try:
            # Parse metadata with data_loader
            df = await analytics_engine.execute_blocking_task(load_dataframe, target_path)
            row_count = len(df)
            if row_count > settings.MAX_DATASET_ROWS:
                raise HTTPException(status_code=400, detail="Dataset exceeds the supported row limit")
            if len(df.columns) == 0 or len(df.columns) > settings.MAX_DATASET_COLUMNS:
                raise HTTPException(status_code=400, detail="Dataset has an unsupported number of columns")
            columns_data = [{"name": str(c), "type": "string" if df[c].dtype == "object" else "number"} for c in df.columns]

            clean_name = name.strip() if name and name.strip() else (file.filename or "Untitled Dataset")
            dataset = Dataset(
                name=clean_name[:191],
                description=description.strip()[:1000] if description else None,
                fileName=file.filename or unique_filename,
                filePath=target_path,
                fileSize=file_size,
                mimeType=(file.content_type or None),
                checksum=checksum,
                rowCount=row_count,
                columns=columns_data,
                userId=user.id
            )
            created = await self.dataset_repo.create(dataset)
            await self.audit_repo.log_action(
                "UPLOAD",
                user_id=user.id,
                dataset_id=created.id,
                details={"datasetId": created.id, "rows": row_count, "fileName": file.filename}
            )
            # Commit metadata and its audit record together before treating the
            # file as an accepted dataset. The surrounding exception handler
            # removes the file if this transaction fails.
            commit_task = asyncio.create_task(self.dataset_repo.session.commit())
            cancelled = None
            while not commit_task.done():
                try:
                    await asyncio.shield(commit_task)
                except asyncio.CancelledError as error:
                    cancelled = error
            await commit_task
            committed = True
            if cancelled is not None:
                raise cancelled
            return created
        except asyncio.CancelledError:
            if not committed:
                try:
                    await self.dataset_repo.session.rollback()
                finally:
                    if os.path.exists(target_path):
                        os.remove(target_path)
            raise
        except HTTPException:
            if os.path.exists(target_path):
                os.remove(target_path)
            raise
        except Exception:
            logger.exception("Failed to process uploaded dataset")
            if os.path.exists(target_path):
                os.remove(target_path)
            raise HTTPException(status_code=400, detail="The dataset could not be processed")

    async def delete_dataset(self, dataset_id: str, user: User) -> bool:
        is_admin = user.role == "ADMIN"
        dataset = await self.dataset_repo.get_accessible_dataset(dataset_id, user_id=user.id, is_admin=is_admin)
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        await self.dataset_repo.delete(dataset)
        await self.audit_repo.log_action(
            "DELETE_DATASET",
            user_id=user.id,
            details={"datasetId": dataset_id, "name": dataset.name}
        )
        await self.dataset_repo.session.commit()

        # Filesystem deletion cannot participate in the database transaction.
        # Delete only after access has been revoked and log any cleanup failure
        # rather than silently hiding orphaned storage.
        if dataset.filePath and os.path.exists(dataset.filePath):
            try:
                await asyncio.to_thread(os.remove, dataset.filePath)
            except OSError:
                logger.exception("Dataset %s was deleted from the database but its file could not be removed", dataset_id)

        await self._invalidate_live_snapshot(dataset.id)
        invalidate_dataframe_cache(dataset.filePath)

        return True

    async def refresh_metadata(self, dataset_id: str, user: User) -> Dataset:
        is_admin = user.role == "ADMIN"
        dataset = await self.dataset_repo.get_accessible_dataset(dataset_id, user_id=user.id, is_admin=is_admin)
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        df = await analytics_engine.execute_blocking_task(load_dataframe, dataset.filePath)
        row_count = len(df)
        columns_data = [{"name": str(c), "type": "string" if df[c].dtype == "object" else "number"} for c in df.columns]

        dataset.rowCount = row_count
        dataset.columns = columns_data
        updated = await self.dataset_repo.update(dataset)

        await self._invalidate_live_snapshot(dataset.id)

        await self.audit_repo.log_action(
            "REFRESH_METADATA",
            user_id=user.id,
            dataset_id=dataset.id,
            details={"rowCount": row_count}
        )
        await self.dataset_repo.session.commit()
        return updated

    async def _invalidate_live_snapshot(self, dataset_id: str) -> None:
        # Wait for active builders/cache writes before removing their result.
        async with _snapshot_lock(dataset_id):
            SNAPSHOT_CACHE.pop(dataset_id, None)
            _prune_snapshot_cache(time.time())
            try:
                from app.core.redis_client import redis_client
                await redis_client.delete(f"snapshot:{dataset_id}")
            except Exception:
                logger.warning("Unable to invalidate Redis snapshot for dataset %s", dataset_id, exc_info=True)

    async def get_live_snapshot(self, dataset: Dataset) -> Dict[str, Any]:
        snapshot_started_at = time.perf_counter()
        lock = _snapshot_lock(dataset.id)

        # A dataset-level lock prevents a connection burst from generating the
        # same expensive DataFrame snapshot once per SSE client.
        async with lock:
            now = time.time()
            _prune_snapshot_cache(now)
            try:
                from app.core.redis_client import redis_client
                redis_cached = await redis_client.get_json(f"snapshot:{dataset.id}")
                if redis_cached:
                    return self._snapshot_with_freshness(redis_cached)
            except Exception:
                logger.warning("Unable to read Redis snapshot for dataset %s", dataset.id, exc_info=True)

            cached = SNAPSHOT_CACHE.get(dataset.id)
            if cached and (now - cached["cached_at"]) < CACHE_TTL_SECONDS:
                SNAPSHOT_CACHE.move_to_end(dataset.id)
                return self._snapshot_with_freshness(cached["snapshot"], cached["cached_at"])

            snapshot = await analytics_engine.execute_blocking_task(
                self._build_live_snapshot,
                dataset,
                snapshot_started_at,
            )
            _cache_snapshot(dataset.id, snapshot)
            try:
                from app.core.redis_client import redis_client
                await redis_client.set_json(f"snapshot:{dataset.id}", snapshot, ex=CACHE_TTL_SECONDS)
            except Exception:
                logger.warning("Unable to store Redis snapshot for dataset %s", dataset.id, exc_info=True)

            return snapshot

    @staticmethod
    def _snapshot_with_freshness(snapshot: Dict[str, Any], cached_at: Optional[float] = None) -> Dict[str, Any]:
        """Return cache metadata without mutating the shared snapshot object."""
        presented = deepcopy(snapshot)
        generated_at = cached_at
        if generated_at is None:
            try:
                generated_at = datetime.datetime.fromisoformat(
                    str(presented.get("meta", {}).get("generatedAt", "")).replace("Z", "+00:00")
                ).timestamp()
            except (TypeError, ValueError):
                generated_at = time.time()
        presented.setdefault("meta", {})["freshnessMs"] = max(0, round((time.time() - generated_at) * 1000, 1))
        return convert_numpy_types(presented)

    @staticmethod
    def _build_live_snapshot(dataset: Dataset, snapshot_started_at: float) -> Dict[str, Any]:
        """Load and summarize a dataset outside FastAPI's event loop."""
        df = load_dataframe(dataset.filePath)
        sample_limit = 180
        sample_rows = df.head(sample_limit).to_dict(orient="records")

        # Fast lightweight stats computation (non-blocking)
        numeric_df = df.select_dtypes(include=["number"])
        numeric_cols = list(numeric_df.columns)
        categorical_cols = list(df.select_dtypes(include=["object", "category", "bool"]).columns)
        
        missing_vals = int(df.isna().sum().sum())
        all_columns = list(df.columns)
        total_cells = len(df) * len(all_columns)
        completeness = round(((total_cells - missing_vals) / total_cells * 100), 1) if total_cells > 0 else 100.0

        primary_metric = numeric_cols[0] if numeric_cols else None
        primary_mean = None
        if primary_metric and len(df) > 0:
            mean_val = df[primary_metric].mean()
            primary_mean = float(mean_val) if pd.notna(mean_val) else None

        snapshot = {
            "datasetId": dataset.id,
            "meta": {
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "freshnessMs": 0,
                "lastModified": datetime.datetime.fromtimestamp(
                    os.path.getmtime(dataset.filePath),
                    datetime.timezone.utc
                ).isoformat(),
                "processingLatencyMs": round((time.perf_counter() - snapshot_started_at) * 1000, 1)
            },
            "dataset": {
                "id": dataset.id,
                "name": dataset.name,
                "description": dataset.description,
                "rowCount": dataset.rowCount,
                "columnCount": len(all_columns)
            },
            "metrics": {
                "rows": dataset.rowCount,
                "columns": len(all_columns),
                "numericColumns": len(numeric_cols),
                "categoricalColumns": len(categorical_cols),
                "missingValues": missing_vals,
                "completeness": completeness,
                "primaryMetricColumn": primary_metric,
                "primaryMean": primary_mean
            },
            "columns": {
                "all": all_columns,
                "numericColumns": numeric_cols,
                "categoricalColumns": categorical_cols,
                "dateColumns": [],
                "measureColumns": numeric_cols,
                "dimensions": categorical_cols
            },
            "sample": {
                "rows": sample_rows,
                "total": len(df),
                "limit": sample_limit
            }
        }

        return convert_numpy_types(snapshot)

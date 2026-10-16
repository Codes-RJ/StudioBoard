"""Report and optionally remove orphaned uploaded files.

Run without --delete-orphans first. The command never deletes database rows.
"""

import argparse
import asyncio
import time
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.storage_leases import LOCK_DIRECTORY, try_storage_artifact_lease
from app.domain.models import AnalyticsJob, Dataset
from app.services.dataset_service import resolve_upload_directory


async def _read_ownership(session_factory) -> tuple[set[Path], set[str]]:
    # A fresh transaction is important: the first sweep snapshot may predate an
    # upload commit even after its writer has released the filesystem lease.
    async with session_factory() as session:
        dataset_paths = (await session.execute(select(Dataset.filePath))).scalars().all()
        jobs = (await session.execute(select(AnalyticsJob.id, AnalyticsJob.outputPath))).all()
    paths = {Path(path).resolve() for path in dataset_paths if path}
    paths.update(Path(path).resolve() for _, path in jobs if path)
    return paths, {job_id for job_id, _ in jobs}


def _is_owned(path: Path, known_paths: set[Path], job_ids: set[str], upload_directory: Path) -> bool:
    if path in known_paths:
        return True
    relative = path.relative_to(upload_directory)
    # A durable job is the reservation for its deterministic export filenames,
    # including .part and promoted output before outputPath commits.
    stem = relative.name.removesuffix(".part").rsplit(".", 1)[0]
    owner_id, separator, attempt = stem.rpartition(".attempt-")
    if separator and attempt.isdigit():
        stem = owner_id
    return len(relative.parts) == 2 and relative.parts[0] == "exports" and stem in job_ids


async def reconcile_storage(delete_orphans: bool = False) -> tuple[list[Path], list[str]]:
    engine = create_async_engine(settings.async_database_url, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    try:
        upload_directory = Path(resolve_upload_directory()).resolve()
        known_paths, job_ids = await _read_ownership(session_factory)
        uploaded_files = [path for path in upload_directory.rglob("*")
                          if path.is_file() and not path.is_symlink()
                          and path.resolve() == path
                          and LOCK_DIRECTORY not in path.relative_to(upload_directory).parts]
        orphaned_files = [path for path in uploaded_files if not _is_owned(path, known_paths, job_ids, upload_directory)]
        missing_files = sorted(str(path) for path in known_paths if not path.exists())

        print(f"Storage reconciliation: {len(orphaned_files)} untracked candidate(s), {len(missing_files)} missing file(s).")
        for missing_path in missing_files:
            print(f"Missing dataset file: {missing_path}")
        for orphan in orphaned_files:
            print(f"Untracked upload candidate: {orphan}")

        if delete_orphans:
            removed = 0
            for orphan in orphaned_files:
                with try_storage_artifact_lease(upload_directory, orphan) as acquired:
                    if not acquired:
                        continue
                    try:
                        if time.time() - orphan.stat().st_mtime < settings.STORAGE_ORPHAN_GRACE_SECONDS:
                            continue
                    except FileNotFoundError:
                        continue
                    current_paths, current_jobs = await _read_ownership(session_factory)
                    if _is_owned(orphan, current_paths, current_jobs, upload_directory):
                        continue
                    orphan.unlink(missing_ok=True)
                    removed += 1
            print(f"Removed {removed} abandoned upload(s); retained fresh, active or newly owned candidates.")

        return orphaned_files, missing_files
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reconcile uploaded files with dataset metadata.")
    parser.add_argument(
        "--delete-orphans",
        action="store_true",
        help="remove uploaded files that no longer have a dataset record",
    )
    args = parser.parse_args()
    asyncio.run(reconcile_storage(delete_orphans=args.delete_orphans))

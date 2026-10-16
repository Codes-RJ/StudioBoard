import pytest
import io
import os
import time
from datetime import timedelta
from sqlalchemy import select

import maintenance
import reconcile_storage
from app.domain.models import AnalyticsJob, Dataset, User, utc_now
from conftest import TestingSessionLocal
from fastapi import UploadFile
from app.repositories.dataset_repository import DatasetRepository
from app.repositories.audit_repository import AuditLogRepository
from app.services.dataset_service import DatasetService


@pytest.mark.asyncio
async def test_storage_reconciliation_reports_and_removes_only_orphans(tmp_path, monkeypatch):
    tracked_file = tmp_path / "tracked.csv"
    tracked_file.write_text("value\n1\n", encoding="utf-8")
    orphan_file = tmp_path / "orphan.csv"
    orphan_file.write_text("value\n2\n", encoding="utf-8")
    abandoned_at = time.time() - 2 * 24 * 60 * 60
    os.utime(orphan_file, (abandoned_at, abandoned_at))

    async with TestingSessionLocal() as session:
        user = User(email="storage@example.com", password="hash", role="USER")
        session.add(user)
        await session.flush()
        session.add(Dataset(
            name="Tracked dataset",
            fileName=tracked_file.name,
            filePath=str(tracked_file.resolve()),
            columns=[],
            userId=user.id,
        ))
        await session.commit()

    monkeypatch.setattr(reconcile_storage, "resolve_upload_directory", lambda: str(tmp_path))

    orphaned, missing = await reconcile_storage.reconcile_storage()
    assert orphaned == [orphan_file.resolve()]
    assert missing == []
    assert orphan_file.exists()

    await reconcile_storage.reconcile_storage(delete_orphans=True)
    assert not orphan_file.exists()
    assert tracked_file.exists()


@pytest.mark.asyncio
async def test_reconciliation_retains_fresh_untracked_files_but_reclaims_abandoned_parts(tmp_path, monkeypatch):
    monkeypatch.setattr(reconcile_storage, "resolve_upload_directory", lambda: str(tmp_path))
    fresh = tmp_path / "awaiting-metadata.csv"
    fresh.write_text("value\n1\n", encoding="utf-8")
    abandoned = tmp_path / "abandoned.csv.part"
    abandoned.write_text("value\n2\n", encoding="utf-8")
    abandoned_at = time.time() - 2 * 24 * 60 * 60
    os.utime(abandoned, (abandoned_at, abandoned_at))

    await reconcile_storage.reconcile_storage(delete_orphans=True)
    assert fresh.exists()
    assert not abandoned.exists()


@pytest.mark.asyncio
async def test_reconciliation_preserves_export_reservations_before_output_path_commits(tmp_path, monkeypatch):
    async with TestingSessionLocal() as session:
        user = User(email="reserved-export@example.com", password="hash", role="USER")
        session.add(user)
        await session.flush()
        job = AnalyticsJob(kind="EXPORT", strategy="export", status="RUNNING", parameters={}, userId=user.id)
        session.add(job)
        await session.commit()
    exports = tmp_path / "exports"
    exports.mkdir()
    files = [exports / f"{job.id}{attempt}.csv{stage}"
             for attempt in ("", ".attempt-1", ".attempt-2") for stage in ("", ".part")]
    for file in files:
        file.write_text("value\n1\n", encoding="utf-8")
        abandoned_at = time.time() - 2 * 24 * 60 * 60
        os.utime(file, (abandoned_at, abandoned_at))
    monkeypatch.setattr(reconcile_storage, "resolve_upload_directory", lambda: str(tmp_path))
    orphaned, missing = await reconcile_storage.reconcile_storage(delete_orphans=True)
    assert orphaned == missing == []
    assert all(file.exists() for file in files)


@pytest.mark.asyncio
async def test_reconciliation_rechecks_committed_ownership_after_initial_snapshot(tmp_path, monkeypatch):
    file = tmp_path / "committing.csv"
    file.write_text("value\n1\n", encoding="utf-8")
    abandoned_at = time.time() - 2 * 24 * 60 * 60
    os.utime(file, (abandoned_at, abandoned_at))
    monkeypatch.setattr(reconcile_storage, "resolve_upload_directory", lambda: str(tmp_path))
    original_read = reconcile_storage._read_ownership
    reads = 0

    async def publish_between_snapshots(session_factory):
        nonlocal reads
        reads += 1
        if reads == 2:
            async with TestingSessionLocal() as session:
                user = User(email="commit-race@example.com", password="hash", role="USER")
                session.add(user)
                await session.flush()
                session.add(Dataset(name="Committing", fileName=file.name, filePath=str(file.resolve()), columns=[], userId=user.id))
                await session.commit()
        return await original_read(session_factory)

    monkeypatch.setattr(reconcile_storage, "_read_ownership", publish_between_snapshots)
    await reconcile_storage.reconcile_storage(delete_orphans=True)
    assert reads == 2
    assert file.exists()


@pytest.mark.asyncio
async def test_real_upload_survives_reconciliation_during_streaming_and_before_commit(tmp_path, monkeypatch):
    monkeypatch.setattr(reconcile_storage, "resolve_upload_directory", lambda: str(tmp_path))
    monkeypatch.setattr(reconcile_storage.settings, "UPLOAD_PATH", str(tmp_path))
    async with TestingSessionLocal() as session:
        user = User(email="live-upload@example.com", password="hash", role="USER")
        session.add(user)
        await session.commit()
        upload = UploadFile(filename="fixture.csv", file=io.BytesIO(b"value\n1\n"))
        original_read = upload.read
        inspected_stage = False

        async def read_with_reconciliation(size):
            nonlocal inspected_stage
            if not inspected_stage:
                inspected_stage = True
                staging = next(tmp_path.glob("*.part"))
                await reconcile_storage.reconcile_storage(delete_orphans=True)
                assert staging.exists()
            return await original_read(size)

        monkeypatch.setattr(upload, "read", read_with_reconciliation)
        original_commit = session.commit

        async def commit_with_reconciliation():
            promoted = next(tmp_path.glob("*.csv"))
            # Even a long-running upload older than the grace period remains active.
            abandoned_at = time.time() - 2 * 24 * 60 * 60
            os.utime(promoted, (abandoned_at, abandoned_at))
            await reconcile_storage.reconcile_storage(delete_orphans=True)
            assert promoted.exists()
            await original_commit()

        monkeypatch.setattr(session, "commit", commit_with_reconciliation)
        dataset = await DatasetService(DatasetRepository(session), AuditLogRepository(session)).upload_dataset(user, upload)
        assert inspected_stage
        assert dataset.filePath == str(next(tmp_path.glob("*.csv")))
        orphaned, missing = await reconcile_storage.reconcile_storage(delete_orphans=True)
        assert orphaned == missing == []


@pytest.mark.asyncio
async def test_storage_reconciliation_preserves_tracked_export_artifacts(tmp_path, monkeypatch):
    exports = tmp_path / "exports"
    exports.mkdir()
    export_file = exports / "completed.csv"
    export_file.write_text("value\n1\n", encoding="utf-8")

    async with TestingSessionLocal() as session:
        user = User(email="export-storage@example.com", password="hash", role="USER")
        session.add(user)
        await session.flush()
        session.add(AnalyticsJob(
            kind="EXPORT", strategy="export", status="SUCCEEDED", parameters={"format": "csv"},
            outputPath=str(export_file.resolve()), userId=user.id,
        ))
        await session.commit()

    monkeypatch.setattr(reconcile_storage, "resolve_upload_directory", lambda: str(tmp_path))
    orphaned, missing = await reconcile_storage.reconcile_storage(delete_orphans=True)
    assert orphaned == []
    assert missing == []
    assert export_file.exists()


@pytest.mark.asyncio
async def test_expired_job_cleanup_removes_only_completed_artifacts(tmp_path, monkeypatch):
    old_file = tmp_path / "old.csv"
    old_file.write_text("value\n1\n", encoding="utf-8")
    recent_file = tmp_path / "recent.csv"
    recent_file.write_text("value\n2\n", encoding="utf-8")
    queued_file = tmp_path / "queued.csv"
    queued_file.write_text("value\n3\n", encoding="utf-8")

    async with TestingSessionLocal() as session:
        user = User(email="retention@example.com", password="hash", role="USER")
        session.add(user)
        await session.flush()
        jobs = [
            AnalyticsJob(
                kind="EXPORT", strategy="export", status="SUCCEEDED", parameters={},
                outputPath=str(old_file), completedAt=utc_now() - timedelta(days=3), userId=user.id,
            ),
            AnalyticsJob(
                kind="EXPORT", strategy="export", status="SUCCEEDED", parameters={},
                outputPath=str(recent_file), completedAt=utc_now(), userId=user.id,
            ),
            AnalyticsJob(
                kind="EXPORT", strategy="export", status="QUEUED", parameters={},
                outputPath=str(queued_file), completedAt=utc_now() - timedelta(days=3), userId=user.id,
            ),
        ]
        session.add_all(jobs)
        await session.commit()
        old_job_id, recent_job_id, queued_job_id = (job.id for job in jobs)

    monkeypatch.setattr(maintenance.settings, "JOB_RESULT_RETENTION_HOURS", 24)
    removed = await maintenance.cleanup_expired_job_artifacts()

    assert removed == 1
    assert not old_file.exists()
    assert recent_file.exists()
    assert queued_file.exists()

    async with TestingSessionLocal() as session:
        remaining = set((await session.execute(select(AnalyticsJob.id))).scalars().all())
    assert old_job_id not in remaining
    assert {recent_job_id, queued_job_id}.issubset(remaining)

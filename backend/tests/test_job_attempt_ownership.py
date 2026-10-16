import asyncio
import io
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import select

import job_worker
from app.core.config import settings
from app.domain.models import AnalyticsJob, Dataset, User, utc_now
from app.repositories.analytics_job_repository import AnalyticsJobRepository
from app.services.analytics.engine import analytics_engine
from app.core.storage_leases import try_storage_artifact_lease
from conftest import TestingSessionLocal


@pytest.fixture
async def queued_job(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_PATH", str(tmp_path))
    monkeypatch.setattr(job_worker, "AsyncSessionLocal", TestingSessionLocal)
    source = tmp_path / "source.csv"; source.write_text("value\n1\n", encoding="utf-8")
    async with TestingSessionLocal() as session, session.begin():
        user = User(email="attempt-fixture@example.com", password="fixture-hash", role="USER")
        session.add(user); await session.flush()
        dataset = Dataset(name="Fixture", fileName="source.csv", filePath=str(source), columns=[], userId=user.id)
        session.add(dataset); await session.flush()
        job = AnalyticsJob(kind="ANALYTICS", strategy="statistics", parameters={}, userId=user.id, datasetId=dataset.id)
        session.add(job); await session.flush()
        return job.id


@pytest.mark.parametrize("outcome", ["analytics", "export", "error"])
async def test_expired_attempt_cannot_overwrite_replacement(queued_job, monkeypatch, outcome):
    job_id = queued_job
    if outcome == "export":
        async with TestingSessionLocal() as session, session.begin():
            job = await session.get(AnalyticsJob, job_id); job.kind = "EXPORT"; job.strategy = "export"
    entered = asyncio.Event(); release = asyncio.Event(); calls = 0
    async def execute(*args):
        nonlocal calls
        calls += 1; first = calls == 1
        if first: entered.set(); await release.wait()
        if outcome == "export": return io.BytesIO(b"expired" if first else b"replacement"), "text/csv", "csv"
        if first and outcome == "error": raise HTTPException(status_code=400, detail="Expired attempt failed")
        return {"winner": "expired" if first else "replacement"}
    monkeypatch.setattr(analytics_engine, "execute_strategy", execute)
    old = asyncio.create_task(job_worker.claim_and_run_once())
    await entered.wait()
    try:
        async with TestingSessionLocal() as session, session.begin():
            job = await session.get(AnalyticsJob, job_id)
            job.startedAt = utc_now() - timedelta(minutes=10)
            if hasattr(job, "leaseExpiresAt"): job.leaseExpiresAt = utc_now() - timedelta(seconds=1)
        async with TestingSessionLocal() as session, session.begin():
            assert await AnalyticsJobRepository(session).recover_stale_jobs(60, 3) == 1
        assert await job_worker.claim_and_run_once()
    finally:
        release.set(); await old
    async with TestingSessionLocal() as session:
        job = await session.get(AnalyticsJob, job_id)
        assert job.attempts == 2
        assert job.status == "SUCCEEDED"
        assert job.error is None
        if outcome == "export":
            assert Path(job.outputPath).read_bytes() == b"replacement"
            assert not list(Path(settings.UPLOAD_PATH).glob("exports/*.attempt-1.*"))
        else:
            assert job.result == {"winner": "replacement"}


async def test_expired_and_requeued_attempts_cannot_renew_or_publish(queued_job):
    async with TestingSessionLocal() as session, session.begin():
        repository = AnalyticsJobRepository(session)
        job = await repository.claim_next()
        first_attempt = job.attempts
        job.leaseExpiresAt = utc_now() - timedelta(seconds=1)
    async with TestingSessionLocal() as session, session.begin():
        repository = AnalyticsJobRepository(session)
        assert not await repository.renew_attempt(queued_job, first_attempt, 60)
        assert not await repository.finish_attempt(queued_job, first_attempt, status="SUCCEEDED", result={"stale": True})
        assert await repository.recover_stale_jobs(60, 3) == 1
        assert not await repository.finish_attempt(queued_job, first_attempt, status="FAILED", error="stale")
        replacement = await repository.claim_next()
        assert replacement.attempts == first_attempt + 1
        assert not await repository.renew_attempt(queued_job, first_attempt, 60)
        assert await repository.finish_attempt(queued_job, replacement.attempts, status="SUCCEEDED", result={"owned": True})


async def test_worker_renews_lease_while_computing_without_a_long_transaction(queued_job, monkeypatch):
    monkeypatch.setattr(settings, "JOB_STALE_AFTER_SECONDS", 0.4)
    entered = asyncio.Event(); finish = asyncio.Event(); renewed = asyncio.Event(); count = 0
    original = AnalyticsJobRepository.renew_attempt
    async def record_renewal(self, *args):
        nonlocal count
        result = await original(self, *args)
        if result:
            count += 1
            if count >= 3: renewed.set()
        return result
    async def compute(*args): entered.set(); await finish.wait(); return {"owned": True}
    monkeypatch.setattr(AnalyticsJobRepository, "renew_attempt", record_renewal)
    monkeypatch.setattr(analytics_engine, "execute_strategy", compute)
    running = asyncio.create_task(job_worker.claim_and_run_once())
    try:
        await entered.wait()
        await asyncio.wait_for(renewed.wait(), timeout=3)
        async with TestingSessionLocal() as session, session.begin():
            job = await session.get(AnalyticsJob, queued_job)
            job.startedAt = utc_now() - timedelta(minutes=10)
        async with TestingSessionLocal() as session, session.begin():
            assert await AnalyticsJobRepository(session).recover_stale_jobs(60, 3) == 0
    finally:
        finish.set(); await running
    async with TestingSessionLocal() as session:
        job = await session.get(AnalyticsJob, queued_job)
        assert job.status == "SUCCEEDED"
        assert job.attempts == 1
        assert job.leaseExpiresAt is None


@pytest.mark.parametrize("stage", ["write", "publication"])
async def test_export_cancellation_drains_owned_side_effect_before_releasing_file_lease(queued_job, monkeypatch, stage):
    async with TestingSessionLocal() as session, session.begin():
        job = await session.get(AnalyticsJob, queued_job); job.kind = "EXPORT"; job.strategy = "export"
    entered = asyncio.Event(); finish = asyncio.Event()
    async def compute(*args): return io.BytesIO(b"owned"), "text/csv", "csv"
    monkeypatch.setattr(analytics_engine, "execute_strategy", compute)
    if stage == "write":
        async def write(function, *args): entered.set(); await finish.wait(); return function(*args)
        monkeypatch.setattr(analytics_engine, "execute_blocking_task", write)
    else:
        original = AnalyticsJobRepository.finish_attempt
        async def publish(self, *args, **kwargs):
            result = await original(self, *args, **kwargs)
            entered.set(); await finish.wait(); return result
        monkeypatch.setattr(AnalyticsJobRepository, "finish_attempt", publish)
    running = asyncio.create_task(job_worker.claim_and_run_once())
    await entered.wait()
    destination = Path(settings.UPLOAD_PATH) / "exports" / f"{queued_job}.attempt-1.csv"
    try:
        running.cancel(); await asyncio.sleep(0)
        running.cancel(); await asyncio.sleep(0)
        with try_storage_artifact_lease(Path(settings.UPLOAD_PATH), destination) as acquired:
            assert not acquired
    finally:
        finish.set()
        with pytest.raises(asyncio.CancelledError): await running
    async with TestingSessionLocal() as session:
        job = await session.get(AnalyticsJob, queued_job)
        if stage == "publication":
            assert job.status == "SUCCEEDED" and destination.read_bytes() == b"owned"
        else:
            assert job.status == "RUNNING" and not destination.exists()
    assert not list(destination.parent.glob("*.part"))


async def test_real_worker_export_remains_downloadable(queued_job, client):
    async with TestingSessionLocal() as session, session.begin():
        job = await session.get(AnalyticsJob, queued_job)
        job.kind = "EXPORT"; job.strategy = "export"; job.parameters = {"format": "csv"}
    assert await job_worker.claim_and_run_once()
    response = await client.get(f"/api/analytics/jobs/{queued_job}/download")
    assert response.status_code == 200
    assert response.text.strip().splitlines() == ["value", "1"]

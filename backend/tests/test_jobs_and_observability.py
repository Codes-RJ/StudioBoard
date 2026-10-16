import asyncio
import io
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from job_worker import claim_and_run_once

from app.domain.models import AnalyticsJob, utc_now
from app.core.telemetry import anonymize_client_ip
from app.repositories.analytics_job_repository import AnalyticsJobRepository
from conftest import TestingSessionLocal


def test_telemetry_anonymizes_client_addresses():
    first = anonymize_client_ip("203.0.113.10")
    assert first == anonymize_client_ip("203.0.113.10")
    assert first != anonymize_client_ip("203.0.113.11")
    assert "203.0.113.10" not in first


@pytest.mark.asyncio
async def test_durable_jobs_validate_parameters_and_expose_metrics(client: AsyncClient):
    upload = await client.post(
        "/api/datasets/upload",
        files={"file": ("job-data.csv", io.BytesIO(b"category,value\nA,10\nB,20\n"), "text/csv")},
    )
    assert upload.status_code == 201
    dataset_id = upload.json()["id"]

    queued = await client.post(
        "/api/analytics/jobs",
        json={"datasetId": dataset_id, "strategy": "statistics", "parameters": {"columns": ["value"]}},
    )
    assert queued.status_code == 202
    job = queued.json()
    assert job["status"] == "QUEUED"
    assert job["kind"] == "ANALYTICS"

    fetched = await client.get(f"/api/analytics/jobs/{job['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == job["id"]

    invalid = await client.post(
        "/api/analytics/jobs",
        json={"datasetId": dataset_id, "strategy": "regression", "parameters": {"x": "value"}},
    )
    assert invalid.status_code == 422

    metrics = await client.get("/metrics")
    assert metrics.status_code == 200
    assert "analytics_http_requests_total" in metrics.text
    assert 'analytics_jobs{status="queued"} 1' in metrics.text

    readiness = await client.get("/health/ready")
    assert readiness.status_code == 200
    assert readiness.json()["services"]["database"] == "connected"


@pytest.mark.asyncio
async def test_worker_claims_and_completes_queued_job(client: AsyncClient):
    upload = await client.post(
        "/api/datasets/upload",
        files={"file": ("worker-data.csv", io.BytesIO(b"category,value\nA,5\nB,15\n"), "text/csv")},
    )
    dataset_id = upload.json()["id"]
    queued = await client.post(
        "/api/analytics/jobs",
        json={"datasetId": dataset_id, "strategy": "statistics", "parameters": {"columns": ["value"]}},
    )
    job_id = queued.json()["id"]

    assert await claim_and_run_once() is True

    completed = await client.get(f"/api/analytics/jobs/{job_id}")
    assert completed.status_code == 200
    assert completed.json()["status"] == "SUCCEEDED"
    assert completed.json()["result"]["value"]["count"] == 2


@pytest.mark.asyncio
async def test_expired_worker_leases_are_requeued_then_fail_at_attempt_limit(client: AsyncClient):
    upload = await client.post(
        "/api/datasets/upload",
        files={"file": ("lease-data.csv", io.BytesIO(b"value\n10\n"), "text/csv")},
    )
    queued = await client.post(
        "/api/analytics/jobs",
        json={"datasetId": upload.json()["id"], "strategy": "statistics", "parameters": {}},
    )
    job_id = queued.json()["id"]

    async with TestingSessionLocal() as session:
        job = (await session.execute(select(AnalyticsJob).where(AnalyticsJob.id == job_id))).scalar_one()
        job.status = "RUNNING"
        job.startedAt = utc_now() - timedelta(minutes=10)
        job.attempts = 1
        await session.commit()

        recovered = await AnalyticsJobRepository(session).recover_stale_jobs(60, 3)
        await session.commit()
        await session.refresh(job)
        assert recovered == 1
        assert job.status == "QUEUED"
        assert job.error == "Worker lease expired; job requeued"

        job.status = "RUNNING"
        job.startedAt = utc_now() - timedelta(minutes=10)
        job.attempts = 3
        await session.commit()

        recovered = await AnalyticsJobRepository(session).recover_stale_jobs(60, 3)
        await session.commit()
        await session.refresh(job)
        assert recovered == 1
        assert job.status == "FAILED"
        assert job.error == "Maximum worker attempts exceeded"
        assert job.completedAt is not None


@pytest.mark.asyncio
async def test_concurrent_uploads_with_the_same_name_remain_distinct(client: AsyncClient):
    async def upload(content: bytes):
        return await client.post(
            "/api/datasets/upload",
            files={"file": ("same-name.csv", io.BytesIO(content), "text/csv")},
        )

    first, second = await asyncio.gather(
        upload(b"value\n1\n"),
        upload(b"value\n2\n"),
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]
    assert first.json()["checksum"] != second.json()["checksum"]

import asyncio
import io
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select

from app.core.config import settings
from app.domain.models import Dataset, User
from app.repositories.audit_repository import AuditLogRepository
from app.repositories.dataset_repository import DatasetRepository
from app.services.dataset_service import DatasetService
from app.services import dataset_service as uploads
from conftest import TestingSessionLocal


@pytest.fixture
async def account(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_PATH", str(tmp_path))
    async with TestingSessionLocal() as session:
        user = User(email="quota-fixture@example.com", password="fixture-hash", role="USER")
        session.add(user); await session.commit()
        return SimpleNamespace(id=user.id, role="USER")


def service(session):
    return DatasetService(DatasetRepository(session), AuditLogRepository(session))


@pytest.mark.parametrize("quota", ["count", "bytes"])
async def test_concurrent_uploads_cannot_exceed_account_policy(account, tmp_path, monkeypatch, quota):
    monkeypatch.setattr(settings, "USER_DATASET_LIMIT", 1 if quota == "count" else 10)
    monkeypatch.setattr(settings, "USER_STORAGE_QUOTA_MB", 1)
    content = b"value\n1\n" if quota == "count" else b"value\n" + b"1\n" * 300_000
    first = UploadFile(filename="first.csv", file=io.BytesIO(content))
    second = UploadFile(filename="second.csv", file=io.BytesIO(content))
    entered = asyncio.Event(); release = asyncio.Event()
    read = first.read
    async def delayed_read(size):
        entered.set(); await release.wait(); return await read(size)
    monkeypatch.setattr(first, "read", delayed_read)
    async with TestingSessionLocal() as one, TestingSessionLocal() as two:
        first_task = asyncio.create_task(service(one).upload_dataset(account, first))
        await entered.wait()
        second_task = asyncio.create_task(service(two).upload_dataset(account, second))
        try:
            await asyncio.sleep(0.1)
        finally:
            release.set()
        results = await asyncio.gather(first_task, second_task, return_exceptions=True)
    assert sum(isinstance(result, Dataset) for result in results) == 1
    rejected = [result for result in results if isinstance(result, HTTPException)]
    assert len(rejected) == 1 and rejected[0].status_code == 400
    assert len(list(tmp_path.glob("*.csv"))) == 1
    assert not list(tmp_path.glob("*.part"))
    async with TestingSessionLocal() as session:
        datasets = (await session.execute(select(Dataset).where(Dataset.userId == account.id))).scalars().all()
        assert len(datasets) == 1
        assert sum(dataset.fileSize for dataset in datasets) <= 1024 * 1024


@pytest.mark.parametrize("stage", ["stream", "parse"])
async def test_cancelled_upload_releases_admission_and_cleans_owned_files(account, tmp_path, monkeypatch, stage):
    entered = asyncio.Event()
    file = UploadFile(filename="cancel.csv", file=io.BytesIO(b"value\n1\n"))
    original = uploads.analytics_engine.execute_blocking_task
    async def stall(*args): entered.set(); await asyncio.Event().wait()
    if stage == "stream": monkeypatch.setattr(file, "read", stall)
    else: monkeypatch.setattr(uploads.analytics_engine, "execute_blocking_task", stall)
    async with TestingSessionLocal() as session:
        task = asyncio.create_task(service(session).upload_dataset(account, file))
        await entered.wait(); task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
    assert not list(tmp_path.glob("*.csv"))
    assert not list(tmp_path.glob("*.part"))
    monkeypatch.setattr(uploads.analytics_engine, "execute_blocking_task", original)
    async with TestingSessionLocal() as session:
        accepted = await asyncio.wait_for(service(session).upload_dataset(
            account, UploadFile(filename="next.csv", file=io.BytesIO(b"value\n2\n")),
        ), timeout=2)
    assert accepted.rowCount == 1


async def test_cancel_during_commit_drains_commit_before_releasing_admission(account, tmp_path, monkeypatch):
    entered = asyncio.Event(); release = asyncio.Event()
    async with TestingSessionLocal() as session:
        commit = session.commit
        async def delayed_commit(): entered.set(); await release.wait(); await commit()
        monkeypatch.setattr(session, "commit", delayed_commit)
        task = asyncio.create_task(service(session).upload_dataset(
            account, UploadFile(filename="commit.csv", file=io.BytesIO(b"value\n1\n")),
        ))
        await entered.wait(); task.cancel(); await asyncio.sleep(0)
        release.set()
        with pytest.raises(asyncio.CancelledError): await task
    async with TestingSessionLocal() as session:
        datasets = (await session.execute(select(Dataset).where(Dataset.userId == account.id))).scalars().all()
        assert len(datasets) == 1
        assert len(list(tmp_path.glob("*.csv"))) == 1

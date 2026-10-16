import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.domain.models import Dataset, Log, User
from conftest import TestingSessionLocal


@pytest.mark.asyncio
async def test_admin_overview_and_user_directory(client: AsyncClient):
    overview = await client.get("/api/admin/overview")
    assert overview.status_code == 200
    assert overview.json()["summary"]["users"] == 1

    users = await client.get("/api/admin/users")
    assert users.status_code == 200
    assert users.json()[0]["role"] == "ADMIN"


@pytest.mark.asyncio
async def test_admin_cross_owner_dataset_reads_are_audited(client: AsyncClient, tmp_path):
    owner_file = tmp_path / "owner.csv"
    owner_file.write_text("value\n1\n", encoding="utf-8")

    # Establish the development test administrator, then create a dataset that
    # belongs to another user directly in the isolated database.
    assert (await client.get("/api/auth/me")).status_code == 200
    async with TestingSessionLocal() as session:
        owner = User(email="owner@example.com", password="hash", role="USER")
        session.add(owner)
        await session.flush()
        dataset = Dataset(
            name="Owner dataset",
            fileName=owner_file.name,
            filePath=str(owner_file),
            columns=[{"name": "value", "type": "number"}],
            userId=owner.id,
        )
        session.add(dataset)
        await session.commit()
        dataset_id = dataset.id

    response = await client.get(f"/api/datasets/{dataset_id}")
    assert response.status_code == 200

    async with TestingSessionLocal() as session:
        audit_events = list((await session.execute(
            select(Log).where(Log.action == "ADMIN_DATASET_METADATA_READ")
        )).scalars())
    assert len(audit_events) == 1
    assert audit_events[0].details["datasetId"] == dataset_id

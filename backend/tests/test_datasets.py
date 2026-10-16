import pytest
import io
from httpx import AsyncClient
from sqlalchemy import select

from app.domain.models import Log
from conftest import TestingSessionLocal


@pytest.mark.asyncio
async def test_dataset_upload_and_delete_flow(client: AsyncClient):
    # 1. Upload CSV directly without auth barriers
    csv_content = b"department,salary,experience\nEngineering,120000,5\nMarketing,80000,3\nSales,95000,4\n"
    files = {"file": ("salaries.csv", io.BytesIO(csv_content), "text/csv")}
    upload_res = await client.post(
        "/api/datasets/upload",
        files=files,
        data={"name": "Company Salaries", "description": "2026 Salary Data"}
    )
    assert upload_res.status_code == 201
    dataset = upload_res.json()
    dataset_id = dataset["id"]
    assert dataset["rowCount"] == 3
    assert len(dataset["columns"]) == 3
    assert dataset["fileSize"] == len(csv_content)
    assert dataset["mimeType"] == "text/csv"
    assert len(dataset["checksum"]) == 64
    # Security: filePath must NOT be exposed to clients
    assert "filePath" not in dataset

    # 2. Test refresh-metadata
    refresh_res = await client.post(f"/api/datasets/{dataset_id}/refresh-metadata")
    assert refresh_res.status_code == 200
    assert refresh_res.json()["rowCount"] == 3
    assert "filePath" not in refresh_res.json()

    # 3. Get layout plan
    plan_res = await client.get(f"/api/datasets/{dataset_id}/layout-plan")
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert len(plan["layout"]) >= 3

    # 4. Get paginated data
    data_res = await client.get(f"/api/datasets/{dataset_id}/data")
    assert data_res.status_code == 200
    assert data_res.json()["total"] == 3

    # 5. Delete dataset
    delete_res = await client.delete(f"/api/datasets/{dataset_id}")
    assert delete_res.status_code == 200

    async with TestingSessionLocal() as session:
        delete_audit = list((await session.execute(
            select(Log).where(Log.action == "DELETE_DATASET")
        )).scalars())
    assert len(delete_audit) == 1
    assert delete_audit[0].datasetId is None

    # 6. Verify 404
    get_res = await client.get(f"/api/datasets/{dataset_id}")
    assert get_res.status_code == 404

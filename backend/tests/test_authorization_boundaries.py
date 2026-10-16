import pytest
from sqlalchemy import select
from app.core.security import create_access_token
from app.domain.models import User, Dataset, DashboardLayout, AnalyticsJob
from app.repositories.dataset_repository import DatasetRepository
from conftest import TestingSessionLocal


@pytest.mark.asyncio
async def test_cross_user_resources_and_sql_shaped_ids_are_rejected(client):
    configured = await client.put('/api/admin/config', json={'features': {
        'serverWorkspace': 'authenticated', 'serverLayouts': 'authenticated',
        'serverAnalytics': 'authenticated', 'serverExports': 'authenticated'}})
    assert configured.status_code == 200
    async with TestingSessionLocal() as session:
        owner = User(email='owner@example.com', password='fixture-only', role='USER')
        outsider = User(email='outsider@example.com', password='fixture-only', role='USER')
        session.add_all([owner, outsider])
        await session.flush()
        source = Dataset(name="'; DROP TABLE User; --", fileName='fixture.csv', filePath='fixture-never-read.csv',
                         columns=['value'], rowCount=1, userId=owner.id)
        layout = DashboardLayout(name="' OR 1=1 --", layout=[], userId=owner.id)
        session.add_all([source, layout])
        await session.flush()
        job = AnalyticsJob(kind='ANALYTICS', strategy='statistics', parameters={}, userId=owner.id, datasetId=source.id)
        session.add(job)
        await session.commit()
        source_id, layout_id, job_id = source.id, layout.id, job.id
        owner_auth = {'Authorization': f'Bearer {create_access_token({"id": owner.id, "ver": 0})}'}
        outsider_auth = {'Authorization': f'Bearer {create_access_token({"id": outsider.id, "ver": 0})}'}
        repository = DatasetRepository(session)
        assert await repository.get_accessible_dataset(source_id) is None
        assert await repository.list_for_user() == ([], 0)
    assert (await client.get(f'/api/datasets/{source_id}', headers=owner_auth)).json()['name'] == "'; DROP TABLE User; --"
    for method, path, body in [
        ('get', f'/api/datasets/{source_id}', None), ('delete', f'/api/datasets/{source_id}', None),
        ('get', f'/api/datasets/{source_id}/data', None),
        ('put', f'/api/layouts/{layout_id}', {'name': 'overwrite', 'layout': [], 'version': 1}),
        ('delete', f'/api/layouts/{layout_id}', None), ('get', f'/api/analytics/jobs/{job_id}', None),
        ('get', f'/api/analytics/jobs/{job_id}/download', None),
        ('post', '/api/analytics/descriptive', {'datasetId': source_id, 'columns': ['value']}),
    ]:
        response = await client.request(method, path, headers=outsider_auth, **({'json': body} if body else {}))
        assert response.status_code == 404, (method, path, response.text)
    assert (await client.get('/api/layouts', headers=outsider_auth)).json() == []
    assert (await client.put('/api/admin/config', headers=outsider_auth, json={})).status_code == 403
    assert (await client.get('/api/datasets/%27%20OR%201%3D1%20--', headers=owner_auth)).status_code == 404
    async with TestingSessionLocal() as session:
        assert len(list((await session.execute(select(User))).scalars())) == 3

from unittest.mock import AsyncMock, Mock
import pytest
import app.main as main_module
from app.core.config import Settings


def test_browser_only_is_the_default_setting(monkeypatch):
    monkeypatch.delenv('ALLOW_SERVER_WORKSPACE', raising=False)
    assert Settings(_env_file=None).ALLOW_SERVER_WORKSPACE is False


@pytest.mark.asyncio
async def test_disabled_server_routes_do_not_access_database_or_telemetry(client, monkeypatch):
    monkeypatch.setattr(main_module.settings, 'ALLOW_SERVER_WORKSPACE', False)
    connect = Mock(side_effect=AssertionError('Personal requests must not access the database'))
    monkeypatch.setattr(main_module, 'engine', Mock(connect=connect))
    track = Mock()
    monkeypatch.setattr(main_module, 'track_request', track)
    for method, path in [('GET', '/api/config'), ('GET', '/api/auth/me'), ('POST', '/api/auth/login'),
                         ('POST', '/api/datasets'), ('PUT', '/api/layouts/private-name'),
                         ('POST', '/api/ai/dashboard-plan'), ('GET', '/api/analytics/live/private/stream'), ('GET', '/metrics')]:
        response = await client.request(method, path, json={'private': 'sentinel'})
        assert response.status_code == 404
        assert response.json()['detail']['code'] == 'LOCAL_ONLY_WORKSPACE'
    ready = await client.get('/health/ready')
    assert ready.status_code == 200
    assert ready.json()['services']['database'] == 'not_required'
    assert (await client.get('/')).json()['docs'] is None
    connect.assert_not_called()
    track.assert_not_called()


@pytest.mark.asyncio
async def test_local_only_startup_does_not_initialize_database(client, monkeypatch):
    monkeypatch.setattr(main_module.settings, 'ALLOW_SERVER_WORKSPACE', False)
    initialize = AsyncMock()
    monkeypatch.setattr(main_module, 'init_db', initialize)
    async with main_module.lifespan(main_module.app):
        initialize.assert_not_awaited()
    initialize.assert_not_awaited()

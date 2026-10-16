import pytest
from slowapi import Limiter
from app.core.limiter import limiter, get_rate_limit_key
from app.core.config import settings


@pytest.fixture
def low_default_limit(monkeypatch):
    configured = Limiter(key_func=get_rate_limit_key, default_limits=["2/minute"], storage_uri="memory://")
    monkeypatch.setattr(limiter, "_default_limits", configured._default_limits)


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/api/config", "/api/layouts", "/api/auth/me"])
async def test_mounted_api_defaults_limit_public_and_authenticated_routes(client, low_default_limit, path):
    responses = [await client.get(path) for _ in range(3)]
    assert [response.status_code for response in responses] == [200, 200, 429]
    assert 1 <= int(responses[-1].headers["retry-after"]) <= 61
    assert responses[-1].headers["cache-control"] == "no-store"
    assert responses[-1].json()["detail"]["code"] == "RATE_LIMIT_EXCEEDED"


@pytest.mark.asyncio
async def test_explicit_login_limit_replaces_defaults_and_counts_once(client, low_default_limit):
    responses = [await client.post("/api/auth/login", json={"email": "missing@example.com", "password": "fixture-password-only"}) for _ in range(6)]
    assert [response.status_code for response in responses] == [401] * 5 + [429]


@pytest.mark.asyncio
async def test_expensive_analytics_route_is_limited_before_invalid_work(client, low_default_limit):
    responses = [await client.post("/api/analytics/descriptive", json={}) for _ in range(3)]
    assert [response.status_code for response in responses] == [422, 422, 429]


@pytest.mark.asyncio
async def test_different_resource_ids_share_endpoint_budget(client, low_default_limit):
    responses = [await client.get(f"/api/datasets/missing-{index}") for index in range(3)]
    assert [response.status_code for response in responses] == [404, 404, 429]


@pytest.mark.asyncio
async def test_health_and_disabled_personal_apis_remain_available_or_unavailable(client, low_default_limit, monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_SERVER_WORKSPACE", False)
    for _ in range(4):
        assert (await client.get("/health/live")).status_code == 200
        assert (await client.get("/api/config")).status_code == 404

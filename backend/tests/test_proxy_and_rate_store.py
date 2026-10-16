import pytest
from fastapi import Request
from redis.exceptions import ConnectionError as RedisConnectionError
from app.core.config import Settings, settings, is_shared_rate_store
from app.core.proxy import client_identity, request_is_https
from app.core.limiter import limiter


def proxy_request(peer, forwarded="203.0.113.9", proto="https"):
    return Request({"type": "http", "method": "GET", "path": "/", "scheme": "http",
                    "server": ("test", 80), "client": (peer, 1234),
                    "headers": [(b"x-forwarded-for", forwarded.encode()), (b"x-forwarded-proto", proto.encode())]})


def test_only_configured_peers_can_supply_single_ip_and_scheme(monkeypatch):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(settings, "TRUSTED_PROXY_CIDRS", "10.9.0.7/32,2001:db8::7/128")
    untrusted = proxy_request("10.9.0.8")
    assert client_identity(untrusted) == "10.9.0.8"
    assert not request_is_https(untrusted)
    assert client_identity(proxy_request("10.9.0.7")) == "203.0.113.9"
    assert request_is_https(proxy_request("2001:db8::7"))
    assert client_identity(proxy_request("10.9.0.7", "1.2.3.4, 203.0.113.9")) == "10.9.0.7"
    assert not request_is_https(proxy_request("10.9.0.7", proto="https,http"))


@pytest.mark.parametrize("url,expected", [(None, False), ("memory://", False), ("redis://", False),
    ("redis://redis:6379/1", True), ("rediss://redis.example:6380/1", True),
    ("redis://redis:70000/1", False), ("http://redis/1", False)])
def test_shared_store_validation(url, expected):
    assert is_shared_rate_store(url) is expected


@pytest.mark.parametrize("cidr", ["0.0.0.0/0", "::/0", "invalid-network"])
def test_proxy_networks_reject_universal_or_invalid_trust(cidr):
    with pytest.raises(ValueError):
        Settings(_env_file=None, TRUSTED_PROXY_CIDRS=cidr)


@pytest.mark.asyncio
@pytest.mark.parametrize("path,method,body", [("/api/config", "get", None),
    ("/api/auth/login", "post", {"email": "fixture@example.com", "password": "fixture-password"})])
async def test_store_outage_fails_closed_for_defaults_and_decorators(client, monkeypatch, path, method, body):
    def unavailable(*args, **kwargs):
        raise RedisConnectionError("fixture outage")
    monkeypatch.setattr(limiter.limiter, "hit", unavailable)
    response = await client.request(method, path, **({"json": body} if body else {}))
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "RATE_LIMIT_STORE_UNAVAILABLE"
    assert response.headers["retry-after"] == "5"
    assert (await client.get("/health/live")).status_code == 200


@pytest.mark.asyncio
async def test_host_is_validated_before_https_redirect_and_request_ids_are_bounded(client, monkeypatch):
    monkeypatch.setattr(settings, 'FORCE_HTTPS', True)
    rejected = await client.get('/api/config', headers={'Host': 'attacker.example'})
    assert rejected.status_code == 400
    assert 'location' not in rejected.headers
    monkeypatch.setattr(settings, 'FORCE_HTTPS', False)
    response = await client.get('/api/config', headers={'X-Request-ID': 'a' * 1024})
    assert len(response.headers['x-request-id']) == 36

from unittest.mock import AsyncMock
import pytest
from fastapi import Request
from slowapi.errors import RateLimitExceeded
from app.core.limiter import enforce_login_account_limit
from app.core.security import create_access_token, dummy_password_hash, hash_password
from app.domain.models import User
from app.domain.schemas import UserLoginRequest
from app.services.auth_service import AuthService
from conftest import TestingSessionLocal


@pytest.mark.asyncio
@pytest.mark.parametrize("headers", [{"Origin": "https://attacker.example"}, {"Origin": "null"}, {"Sec-Fetch-Site": "cross-site"}])
async def test_login_rejects_unapproved_browser_origins(client, headers):
    response = await client.post("/api/auth/login", headers=headers, json={"email": "missing@example.com", "password": "fixture-password"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_unknown_user_runs_current_password_verifier(monkeypatch):
    import app.services.auth_service as module
    calls = []
    def verify(password, stored):
        calls.append((password, stored))
        return False, False
    repo = AsyncMock()
    repo.get_by_email.return_value = None
    monkeypatch.setattr(module, "verify_password_with_upgrade", verify)
    with pytest.raises(Exception) as error:
        await AuthService(repo, AsyncMock()).login(UserLoginRequest(email="missing@example.com", password="fixture-password"))
    assert error.value.status_code == 401
    assert calls == [("fixture-password", dummy_password_hash())]


def test_account_budget_is_shared_across_clients_and_normalizes_email():
    request = Request({"type": "http", "headers": [], "client": ("203.0.113.1", 1)})
    for _ in range(20):
        enforce_login_account_limit(request, "Fixture@Example.com")
    other = Request({"type": "http", "headers": [], "client": ("203.0.113.2", 2)})
    with pytest.raises(RateLimitExceeded):
        enforce_login_account_limit(other, " fixture@example.com ")
    enforce_login_account_limit(other, "different@example.com")


@pytest.mark.asyncio
async def test_bearer_logout_revokes_replays_and_cookie_precedence_is_consistent(client):
    async with TestingSessionLocal() as session:
        user = User(email="bearer@example.com", password=hash_password("fixture-password"), role="USER")
        session.add(user)
        await session.commit()
        token = create_access_token({"id": user.id, "ver": user.tokenVersion})
    auth = {"Authorization": f"Bearer {token}"}
    assert (await client.get("/api/auth/me", headers=auth)).status_code == 200
    client.cookies.set("token", "invalid-cookie")
    assert (await client.get("/api/auth/me", headers=auth)).status_code == 401
    assert (await client.post("/api/auth/logout", headers=auth)).status_code == 403
    client.cookies.clear()
    assert (await client.post("/api/auth/logout", headers=auth)).status_code == 200
    assert (await client.get("/api/auth/me", headers=auth)).status_code == 401

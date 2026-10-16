import pytest
import importlib
import bcrypt
from sqlalchemy import select

from app.core.security import PASSWORD_HASH_VERSION, apply_pepper, hash_password, verify_password
from app.domain.models import User

from conftest import TestingSessionLocal


def test_password_hashing_supports_long_unicode_passwords():
    password = "correct-horse-" + ("\U0001f512" * 80)
    hashed = hash_password(password)

    assert hashed.startswith(PASSWORD_HASH_VERSION)
    assert verify_password(password, hashed)
    assert not verify_password(f"{password}!", hashed)


@pytest.mark.asyncio
async def test_login_upgrades_legacy_password_hash_and_logout_revokes_token(client):
    password = "a-legacy-secure-password"
    legacy_hash = bcrypt.hashpw(
        apply_pepper(password).encode("utf-8"),
        bcrypt.gensalt(rounds=4),
    ).decode("utf-8")

    async with TestingSessionLocal() as session:
        session.add(User(email="legacy-admin@example.com", password=legacy_hash, role="ADMIN"))
        await session.commit()

    login = await client.post(
        "/api/auth/login",
        json={"email": "legacy-admin@example.com", "password": password},
    )
    assert login.status_code == 200
    issued_token = client.cookies.get("token")
    csrf_token = client.cookies.get("csrf_token")

    async with TestingSessionLocal() as session:
        migrated = (await session.execute(select(User).where(User.email == "legacy-admin@example.com"))).scalar_one()
        assert migrated.password.startswith(PASSWORD_HASH_VERSION)

    logout = await client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf_token})
    assert logout.status_code == 200

    replay = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {issued_token}"})
    assert replay.status_code == 401


def test_production_settings_require_shared_rate_limit_storage(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("JWT_SECRET", "a-unique-production-secret-that-is-long-enough")
    monkeypatch.setenv("PASSWORD_PEPPER", "a-unique-production-pepper")
    monkeypatch.setenv("DATABASE_URL", "mysql+aiomysql://user:password@localhost:3306/analytics")
    monkeypatch.setenv("CLIENT_ORIGIN", "https://app.example.com")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")
    monkeypatch.setenv("TRUSTED_HOSTS", "app.example.com")
    monkeypatch.setenv("FORCE_HTTPS", "true")
    monkeypatch.setenv("RATE_LIMITING_DISABLED", "false")
    monkeypatch.delenv("RATE_LIMIT_STORAGE_URL", raising=False)

    import app.core.config as config_module
    with pytest.raises(RuntimeError, match="RATE_LIMIT_STORAGE_URL"):
        importlib.reload(config_module)

    # Restore the test settings module after the isolated production import.
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("RATE_LIMIT_STORAGE_URL", "memory://")
    importlib.reload(config_module)


@pytest.mark.asyncio
async def test_public_settings_are_validated_and_admin_changes_are_audited(client):
    initial = await client.get("/api/config")
    assert initial.status_code == 200
    assert initial.json()["branding"]["siteName"] == "Analytics Dashboard"
    assert initial.headers["x-content-type-options"] == "nosniff"
    assert initial.headers["cache-control"] == "no-store"

    update = await client.put(
        "/api/admin/config",
        json={
            "branding": {
                "siteName": "Operations Hub",
                "homeTitle": "Operations Hub",
                "homeDescription": "Use datasets to make accurate operational decisions.",
                "primaryColor": "#0EA5E9",
                "template": "focused",
            },
            "features": {
                "localUpload": True,
                "urlImport": False,
                "dataAssistant": True,
                "reports": True,
                "exports": True,
                "serverWorkspace": "admin",
                "serverAnalytics": "disabled",
                "serverLayouts": "admin",
                "serverExports": "admin",
            },
        },
    )
    assert update.status_code == 200
    assert update.json()["branding"]["siteName"] == "Operations Hub"
    assert update.json()["features"]["serverAnalytics"] == "disabled"

    invalid = await client.put("/api/admin/config", json={"branding": {"primaryColor": "blue"}})
    assert invalid.status_code == 422


@pytest.mark.asyncio
async def test_cookie_authenticated_writes_require_csrf_token(client):
    async with TestingSessionLocal() as session:
        session.add(
            User(
                email="secure-admin@example.com",
                name="Secure Admin",
                password=hash_password("a-long-secure-password"),
                role="ADMIN",
            )
        )
        await session.commit()

    login = await client.post(
        "/api/auth/login",
        json={"email": "secure-admin@example.com", "password": "a-long-secure-password"},
    )
    assert login.status_code == 200
    csrf_token = client.cookies.get("csrf_token")
    assert csrf_token

    rejected = await client.put("/api/admin/config", json={})
    assert rejected.status_code == 403

    accepted = await client.put("/api/admin/config", json={}, headers={"X-CSRF-Token": csrf_token})
    assert accepted.status_code == 200

    async with TestingSessionLocal() as session:
        users = list((await session.execute(select(User))).scalars().all())
    assert len(users) == 1

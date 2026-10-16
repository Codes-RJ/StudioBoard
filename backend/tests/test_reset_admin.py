import pytest
from sqlalchemy import select

from app.core.security import verify_password
from app.domain.models import Dataset, User
from reset_admin import reset_users

from conftest import TestingSessionLocal


@pytest.mark.asyncio
async def test_reset_admin_replaces_users_and_removes_uploaded_data(tmp_path, monkeypatch):
    uploaded_file = tmp_path / "previous-dataset.csv"
    uploaded_file.write_text("value\n1\n", encoding="utf-8")

    async with TestingSessionLocal() as session:
        previous_user = User(email="previous@example.com", password="old-password", role="USER")
        session.add(previous_user)
        await session.flush()
        session.add(
            Dataset(
                name="Previous dataset",
                fileName=uploaded_file.name,
                filePath=str(uploaded_file),
                columns="[]",
                userId=previous_user.id,
            )
        )
        await session.commit()

    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "a-long-test-password")
    monkeypatch.setenv("ADMIN_NAME", "Primary Admin")

    await reset_users(confirm=True)

    async with TestingSessionLocal() as session:
        users = list((await session.execute(select(User))).scalars().all())
        datasets = list((await session.execute(select(Dataset))).scalars().all())

    assert len(users) == 1
    assert users[0].email == "admin@example.com"
    assert users[0].name == "Primary Admin"
    assert users[0].role == "ADMIN"
    assert verify_password("a-long-test-password", users[0].password)
    assert datasets == []
    assert not uploaded_file.exists()


@pytest.mark.asyncio
async def test_reset_admin_accepts_long_unicode_password(tmp_path, monkeypatch):
    password = "admin-password-" + ("\U0001f512" * 80)
    monkeypatch.setenv("ADMIN_EMAIL", "long-password@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", password)

    await reset_users(confirm=True)

    async with TestingSessionLocal() as session:
        user = (await session.execute(select(User))).scalar_one()
    assert verify_password(password, user.password)

import pytest
import os
import sys
import tempfile
from typing import AsyncGenerator
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_root not in sys.path:
    sys.path.insert(0, backend_root)

# Create a temporary file for test db
temp_db_fd, temp_db_path = tempfile.mkstemp(suffix=".db")
os.close(temp_db_fd)

os.environ["NODE_ENV"] = "test"
# Existing API tests explicitly exercise the separate legacy server product.
os.environ["ALLOW_SERVER_WORKSPACE"] = "true"
os.environ["JWT_SECRET"] = "test-secret-key-that-is-at-least-32-bytes-long"
os.environ["PASSWORD_PEPPER"] = "test_pepper_123"
os.environ["DEV_AUTH_BYPASS"] = "true"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{temp_db_path.replace(os.sep, '/')}"
os.environ["RATE_LIMIT_STORAGE_URL"] = "memory://"
os.environ["RATE_LIMITING_DISABLED"] = "false"

from app.core.database import Base, get_db
from app.main import app, api_router
from app.core.limiter import limiter

test_engine = create_async_engine(
    f"sqlite+aiosqlite:///{temp_db_path.replace(os.sep, '/')}",
    connect_args={"check_same_thread": False},
)
TestingSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False)


@pytest.fixture(autouse=True)
async def setup_test_db():
    limiter.reset()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with TestingSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


app.dependency_overrides[get_db] = override_get_db
api_router.dependency_overrides[get_db] = override_get_db


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

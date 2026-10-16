from typing import Callable, Optional, AsyncGenerator
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.core.security import decode_access_token, verify_csrf_token
from app.core.site_settings import resolve_site_settings
from app.domain.models import User
from app.repositories.user_repository import UserRepository
from app.repositories.dataset_repository import DatasetRepository
from app.repositories.layout_repository import LayoutRepository
from app.repositories.audit_repository import AuditLogRepository
from app.repositories.config_repository import SiteConfigRepository
from app.repositories.analytics_job_repository import AnalyticsJobRepository
from app.services.auth_service import AuthService
from app.services.dataset_service import DatasetService

security_bearer = HTTPBearer(auto_error=False)
AUTH_COOKIE_NAME = "token"
CSRF_COOKIE_NAME = "csrf_token"


# --- Repository Dependencies ---
def get_user_repository(session: AsyncSession = Depends(get_db)) -> UserRepository:
    return UserRepository(session)


def get_dataset_repository(session: AsyncSession = Depends(get_db)) -> DatasetRepository:
    return DatasetRepository(session)


def get_layout_repository(session: AsyncSession = Depends(get_db)) -> LayoutRepository:
    return LayoutRepository(session)


def get_audit_repository(session: AsyncSession = Depends(get_db)) -> AuditLogRepository:
    return AuditLogRepository(session)


def get_config_repository(session: AsyncSession = Depends(get_db)) -> SiteConfigRepository:
    return SiteConfigRepository(session)


def get_analytics_job_repository(session: AsyncSession = Depends(get_db)) -> AnalyticsJobRepository:
    return AnalyticsJobRepository(session)


# --- Service Dependencies ---
def get_auth_service(
    user_repo: UserRepository = Depends(get_user_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository)
) -> AuthService:
    return AuthService(user_repo, audit_repo)


def get_dataset_service(
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository)
) -> DatasetService:
    return DatasetService(dataset_repo, audit_repo)


# --- Current User / Auth Guard ---
async def get_current_user(
    request: Request,
    auth_header: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    user_repo: UserRepository = Depends(get_user_repository)
) -> User:
    token = request.cookies.get(AUTH_COOKIE_NAME)
    if not token and auth_header:
        token = auth_header.credentials

    if token:
        payload = decode_access_token(token)
        if payload and "id" in payload:
            user = await user_repo.get_by_id(payload["id"])
            if user and payload.get("ver", 0) == user.tokenVersion:
                return user
        # Development bypass is only for requests without credentials. An
        # explicitly invalid, expired, or revoked token must never become an
        # implicit administrator session.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )

    if not settings.DEV_AUTH_BYPASS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )

    # Test-only bypass. Keep it opt-in so development and production databases
    # cannot acquire an implicit second administrator.
    dev_user = await user_repo.get_by_email("dev@local")
    if not dev_user:
        dev_user = User(
            email="dev@local",
            name="Developer",
            password="dev",
            role="ADMIN"
        )
        try:
            dev_user = await user_repo.create(dev_user)
        except IntegrityError:
            # Concurrent first requests may both observe the bypass account as
            # absent. The email constraint chooses the winner; the loser can
            # safely restart its transaction and reuse that committed row.
            await user_repo.session.rollback()
            dev_user = await user_repo.get_by_email("dev@local")
            if not dev_user:
                raise
    return dev_user


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrative privileges required"
        )
    return current_user


async def require_csrf(request: Request) -> None:
    """Protect cookie-authenticated write requests; bearer clients are unaffected."""
    if not request.cookies.get(AUTH_COOKIE_NAME):
        return
    csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME, "")
    csrf_header = request.headers.get("x-csrf-token", "")
    if not verify_csrf_token(csrf_cookie, csrf_header):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")


async def require_login_origin(request: Request) -> None:
    """Block browser login CSRF before the first authentication cookie exists."""
    origin = request.headers.get("origin")
    if origin is not None and origin not in settings.cors_origins_list:
        raise HTTPException(status_code=403, detail="Login origin rejected")
    if origin is None and request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(status_code=403, detail="Login origin rejected")
    await require_csrf(request)  # Switching an existing cookie account needs its CSRF token.


def require_feature(feature_name: str) -> Callable:
    async def feature_guard(
        current_user: User = Depends(get_current_user),
        config_repo: SiteConfigRepository = Depends(get_config_repository),
    ) -> User:
        site_settings = resolve_site_settings(await config_repo.get_all_as_dict())
        access = getattr(site_settings.features, feature_name)
        if access == "disabled":
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="This feature is currently unavailable")
        if access == "admin" and current_user.role != "ADMIN":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This feature requires administrator access")
        return current_user

    return feature_guard

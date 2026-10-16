from fastapi import APIRouter, Depends, Request, Response

from app.core.config import settings
from app.core.limiter import limiter, enforce_login_account_limit
from app.core.security import create_csrf_token, decode_access_token, parse_expiration_delta
from app.domain.models import User
from app.domain.schemas import UserLoginRequest, UserResponse
from app.api.dependencies import CSRF_COOKIE_NAME, get_auth_service, get_current_user, get_user_repository, require_csrf, require_login_origin
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAME = "token"


def _set_auth_cookie(response: Response, token: str) -> None:
    """
    HttpOnly prevents token reads through document.cookie. SameSite limits
    cross-site delivery; it does not make the entire application XSS-safe.
    """
    max_age = int(parse_expiration_delta(settings.JWT_EXPIRES_IN).total_seconds())
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        max_age=max_age,
        path="/",
    )
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=create_csrf_token(),
        httponly=False,
        secure=settings.is_production,
        samesite="lax",
        max_age=max_age,
        path="/",
    )


@router.post("/login", response_model=UserResponse, dependencies=[Depends(require_login_origin)])
@limiter.limit("5/minute")
async def login(request: Request, req: UserLoginRequest, response: Response, auth_service: AuthService = Depends(get_auth_service)):
    enforce_login_account_limit(request, req.email)
    user, token = await auth_service.login(req)
    _set_auth_cookie(response, token)
    return user


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    csrf_protected: None = Depends(require_csrf),
    user_repo: UserRepository = Depends(get_user_repository),
):
    # The application currently has no server-side session table. Incrementing
    # this value invalidates every JWT issued before logout, including a copied
    # cookie on another device.
    token = request.cookies.get(COOKIE_NAME, "")
    if not token:
        scheme, _, credentials = request.headers.get("authorization", "").partition(" ")
        token = credentials if scheme.lower() == "bearer" else ""
    payload = decode_access_token(token)
    if payload and payload.get("id"):
        current_user = await user_repo.get_by_id(payload["id"])
        if current_user and payload.get("ver", 0) == current_user.tokenVersion:
            current_user.tokenVersion += 1
            await user_repo.update(current_user)
    response.delete_cookie(key=COOKIE_NAME, path="/")
    response.delete_cookie(key=CSRF_COOKIE_NAME, path="/")
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return current_user

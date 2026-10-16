from slowapi import Limiter
from redis.exceptions import RedisError
from limits.errors import StorageError
from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.wrappers import Limit
from math import ceil
from time import time
import hashlib
import hmac
from limits import parse
from app.core.config import settings
from app.core.proxy import client_identity


class RateLimitStoreUnavailable(Exception):
    pass


class FailClosedLimiter(Limiter):
    def _check_request_limit(self, *args, **kwargs):
        try:
            return super()._check_request_limit(*args, **kwargs)
        except (RedisError, StorageError) as exc:
            raise RateLimitStoreUnavailable() from exc


def rate_limit_store_unavailable_handler(request: Request, exc: Exception):
    return JSONResponse(
        {"detail": {"code": "RATE_LIMIT_STORE_UNAVAILABLE", "message": "Request protection is temporarily unavailable."}},
        status_code=503, headers={"Retry-After": "5", "Cache-Control": "no-store"},
    )


def enforce_login_account_limit(request: Request, email: str):
    """Temporary shared attempt budget; never store email/password as a Redis key."""
    if not limiter.enabled:
        return
    account = hmac.new(settings.JWT_SECRET.encode(), email.strip().lower().encode(), hashlib.sha256).hexdigest()
    window = parse("20/15 minute")
    identifiers = (account, "login-account")
    try:
        accepted = limiter.limiter.hit(window, *identifiers)
    except (RedisError, StorageError) as exc:
        raise RateLimitStoreUnavailable() from exc
    if not accepted:
        request.state.view_rate_limit = (window, identifiers)
        raise RateLimitExceeded(Limit(window, get_rate_limit_key, None, False, None, None, None, 1, True))


async def enforce_default_rate_limit(request: Request):
    """Check after FastAPI resolves the endpoint, including nested included routers."""
    endpoint = request.scope.get("endpoint")
    if not limiter.enabled or endpoint is None:
        return
    name = f"{endpoint.__module__}.{endpoint.__name__}"
    if name in limiter._route_limits or name in limiter._exempt_routes:
        return  # Explicit decorators own their policy and must count once.
    limiter._check_request_limit(request, endpoint, in_middleware=True)
    request.state._rate_limiting_complete = True


def get_rate_limit_key(request: Request) -> str:
    return client_identity(request)


limiter = FailClosedLimiter(
    key_func=get_rate_limit_key,
    default_limits=[settings.default_rate_limit],
    storage_uri=settings.RATE_LIMIT_STORAGE_URL or "memory://",
    storage_options={"socket_connect_timeout": 2, "socket_timeout": 2}
        if (settings.RATE_LIMIT_STORAGE_URL or "").startswith(("redis://", "rediss://")) else {},
    headers_enabled=False,
    enabled=not settings.RATE_LIMITING_DISABLED,
    key_style="endpoint",  # IDs/query choices must not create fresh request budgets.
)


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """Return usable retry information without requiring injected success headers."""
    window, identifiers = request.state.view_rate_limit
    try:
        reset_at, _ = request.app.state.limiter.limiter.get_window_stats(window, *identifiers)
    except (RedisError, StorageError):
        return rate_limit_store_unavailable_handler(request, exc)
    retry_seconds = max(1, ceil(reset_at - time()))
    return JSONResponse(
        {"detail": {"code": "RATE_LIMIT_EXCEEDED", "message": "Too many requests. Try again later."}},
        status_code=429,
        headers={"Retry-After": str(retry_seconds), "Cache-Control": "no-store"},
    )

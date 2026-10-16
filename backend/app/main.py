import time
import re
from uuid import uuid4
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import func, select
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from sqlalchemy import text
from starlette.middleware.trustedhost import TrustedHostMiddleware

from slowapi.errors import RateLimitExceeded
from app.core.limiter import (limiter, rate_limit_exceeded_handler, enforce_default_rate_limit,
                             RateLimitStoreUnavailable, rate_limit_store_unavailable_handler)
from app.core.proxy import client_identity, request_is_https
from app.core.config import settings
from app.core.database import engine, init_db
from app.core.redis_client import ping_redis_url, redis_client
from app.core.telemetry import flush_telemetry_tasks, render_prometheus_metrics, track_request
from app.domain.models import AnalyticsJob
from app.api.v1 import admin, ai, analytics, auth, config, datasets, layouts

_started_at = time.monotonic()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.ALLOW_SERVER_WORKSPACE:
        # Personal workspaces need neither schema initialization nor telemetry.
        yield
        await engine.dispose()
        return
    # Development/test environments can bootstrap disposable tables. Production
    # schema changes are applied by Alembic before Uvicorn starts.
    try:
        if not settings.is_production:
            await init_db()
        print(f"Unified Python Backend running on port {settings.PORT}")
        print(f"   Environment: {settings.NODE_ENV}")
        print(f"   Database: Connected")
    except Exception as e:
        if settings.is_production:
            raise RuntimeError("Database initialization failed; refusing production startup") from e
        print(f"Database initialization notice: {e}")
    yield
    # Shutdown
    await flush_telemetry_tasks()
    await redis_client.close()
    await engine.dispose()


app = FastAPI(
    title="Analytics Dashboard API",
    description="Unified High-Performance Analytics Dashboard Backend",
    version="2.0.0",
    lifespan=lifespan,
    docs_url=None if settings.is_production or not settings.ALLOW_SERVER_WORKSPACE else "/docs",
    redoc_url=None if settings.is_production or not settings.ALLOW_SERVER_WORKSPACE else "/redoc",
    openapi_url=None if settings.is_production or not settings.ALLOW_SERVER_WORKSPACE else "/openapi.json",
)

app.state.limiter = limiter

# Security and telemetry middleware
@app.middleware("http")
async def security_and_telemetry_middleware(request: Request, call_next):
    start_time = time.time()
    supplied_id = request.headers.get("x-request-id", "")
    request_id = supplied_id if re.fullmatch(r"[A-Za-z0-9._-]{1,128}", supplied_id) else str(uuid4())
    is_https = request_is_https(request)

    # Container orchestration probes the private health endpoints over HTTP;
    # browser/API traffic remains redirected to the TLS-terminating proxy.
    if not settings.ALLOW_SERVER_WORKSPACE and (request.url.path == "/api" or request.url.path.startswith("/api/") or request.url.path == "/metrics"):
        response = JSONResponse({"detail": {"code": "LOCAL_ONLY_WORKSPACE", "message": "Server workspace endpoints are disabled."}}, status_code=404)
    elif settings.FORCE_HTTPS and not is_https and not request.url.path.startswith("/health"):
        response = RedirectResponse(url=str(request.url.replace(scheme="https")), status_code=307)
    else:
        response = await call_next(request)
    duration_ms = (time.time() - start_time) * 1000
    
    ip = client_identity(request)
    if settings.ALLOW_SERVER_WORKSPACE:
        track_request(
            method=request.method,
            path=request.url.path,
            ip=ip,
            status_code=response.status_code,
            duration_ms=duration_ms,
            request_id=request_id,
        )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    response.headers["X-Request-ID"] = request_id
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    if settings.FORCE_HTTPS and is_https:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list or ["http://localhost:5173"],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$" if not settings.is_production else None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "X-Request-ID"],
)
# Host validation must run before middleware that builds HTTPS redirect URLs.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts_list)


# Mount API Routers under /api
api_router = FastAPI(docs_url=None, redoc_url=None, openapi_url=None,
                    dependencies=[Depends(enforce_default_rate_limit)])
# Resolve endpoints through FastAPI itself: newer included routers are deferred
# containers that SlowAPI's flat middleware route lookup cannot inspect.
api_router.state.limiter = limiter
api_router.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
api_router.add_exception_handler(RateLimitStoreUnavailable, rate_limit_store_unavailable_handler)
api_router.include_router(auth.router)
api_router.include_router(admin.router)
api_router.include_router(datasets.router)
api_router.include_router(layouts.router)
api_router.include_router(analytics.router)
api_router.include_router(ai.router)
api_router.include_router(config.router)

app.mount("/api", api_router)


# Health check endpoints: liveness never touches dependencies; readiness does.
@app.get("/health/live")
async def liveness_check():
    return {
        "status": "OK",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "environment": settings.NODE_ENV,
        "version": app.version,
    }


@app.get("/health")
@app.get("/health/ready")
async def readiness_check():
    if not settings.ALLOW_SERVER_WORKSPACE:
        return {"status": "OK", "version": app.version, "workspace": "browser-only", "services": {"database": "not_required", "rateLimitStore": "not_required", "cache": "not_required"}}
    db_status = "disconnected"
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            db_status = "connected"
    except Exception:
        db_status = "error"

    rate_limit_status = "not_required"
    cache_status = "not_configured"
    required_services_ready = db_status == "connected"

    if settings.is_production:
        rate_limit_ready = await ping_redis_url(settings.RATE_LIMIT_STORAGE_URL)
        rate_limit_status = "connected" if rate_limit_ready else "error"
        required_services_ready = required_services_ready and rate_limit_ready

    if settings.REDIS_URL:
        cache_ready = await ping_redis_url(settings.REDIS_URL)
        cache_status = "connected" if cache_ready else "error"

    overall_status = "OK" if required_services_ready else "DEGRADED"
    payload = {
        "status": overall_status,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "uptime": int(time.monotonic() - _started_at),
        "environment": settings.NODE_ENV,
        "version": app.version,
        "services": {
            "database": db_status,
            "rateLimitStore": rate_limit_status,
            "cache": cache_status,
            "analyticsEngine": "in-process (unified)",
        },
    }

    return JSONResponse(payload, status_code=200 if required_services_ready else 503)


@app.get("/metrics", include_in_schema=False)
async def metrics(
    authorization: str | None = Header(default=None),
):
    """Token-protected, scrape-friendly operational metrics."""
    if settings.METRICS_TOKEN and authorization != f"Bearer {settings.METRICS_TOKEN}":
        raise HTTPException(status_code=401, detail="Metrics authentication required")
    async with engine.connect() as connection:
        result = await connection.execute(
            select(AnalyticsJob.status, func.count()).group_by(AnalyticsJob.status)
        )
        job_counts = {status.lower(): count for status, count in result.all()}
    return PlainTextResponse(render_prometheus_metrics(job_counts), media_type="text/plain; version=0.0.4")


@app.get("/")
async def root():
    return {
        "service": "Analytics Dashboard Unified Backend",
        "status": "running",
        "version": app.version,
        "docs": None if settings.is_production or not settings.ALLOW_SERVER_WORKSPACE else "/docs"
    }

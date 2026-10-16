from typing import Any, Dict, List

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_db, require_admin
from app.core.telemetry import get_system_metrics, get_traffic_snapshot
from app.core.limiter import limiter
from app.core.config import settings
from app.domain.models import DashboardLayout, Dataset, Log, User

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/overview")
@limiter.limit("60/minute")
async def get_admin_overview(
    request: Request,
    current_admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    user_count = (await session.execute(select(func.count()).select_from(User))).scalar() or 0
    dataset_count = (await session.execute(select(func.count()).select_from(Dataset))).scalar() or 0
    layout_count = (await session.execute(select(func.count()).select_from(DashboardLayout))).scalar() or 0
    audit_count = (await session.execute(select(func.count()).select_from(Log))).scalar() or 0

    return {
        "admin": {
            "id": current_admin.id,
            "email": current_admin.email,
            "name": current_admin.name,
        },
        "summary": {
            "users": user_count,
            "datasets": dataset_count,
            "layouts": layout_count,
            "auditEvents": audit_count,
        },
        "traffic": get_traffic_snapshot(),
        "system": get_system_metrics(),
        "security": {
            "rateLimitingEnabled": not settings.RATE_LIMITING_DISABLED,
            "defaultRateLimit": settings.default_rate_limit,
            "csrfProtection": True,
            "forceHttps": settings.FORCE_HTTPS,
        },
    }


@router.get("/users")
@limiter.limit("60/minute")
async def list_users(
    request: Request,
    limit: int = Query(50, ge=1, le=100),
    current_admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    result = await session.execute(select(User).order_by(User.createdAt.desc()).limit(limit))
    return [
        {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "createdAt": user.createdAt.isoformat(),
        }
        for user in result.scalars().all()
    ]

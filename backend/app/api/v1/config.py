from fastapi import APIRouter, Depends, Request

from app.api.dependencies import get_audit_repository, get_config_repository, require_admin, require_csrf
from app.core.limiter import limiter
from app.core.site_settings import SiteSettings, SiteSettingsUpdate, resolve_site_settings, update_site_settings
from app.domain.models import User
from app.repositories.config_repository import SiteConfigRepository
from app.repositories.audit_repository import AuditLogRepository

router = APIRouter(tags=["config"])

async def get_resolved_settings(config_repo: SiteConfigRepository) -> SiteSettings:
    return resolve_site_settings(await config_repo.get_all_as_dict())


@router.get("/config", response_model=SiteSettings)
async def get_public_config(config_repo: SiteConfigRepository = Depends(get_config_repository)) -> SiteSettings:
    return await get_resolved_settings(config_repo)


@router.put("/admin/config", response_model=SiteSettings)
@limiter.limit("20/minute")
async def update_site_config(
    request: Request,
    updates: SiteSettingsUpdate,
    current_admin: User = Depends(require_admin),
    csrf_protected: None = Depends(require_csrf),
    config_repo: SiteConfigRepository = Depends(get_config_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository),
) -> SiteSettings:
    current = await get_resolved_settings(config_repo)
    updated = update_site_settings(current, updates)
    await config_repo.set_value("site_settings", updated.model_dump())
    changed_sections = list(updates.model_dump(exclude_none=True).keys())
    await audit_repo.log_action("UPDATE_SITE_SETTINGS", user_id=current_admin.id, details={"sections": changed_sections})
    return updated

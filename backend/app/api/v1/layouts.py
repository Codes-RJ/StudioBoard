from typing import List
from fastapi import APIRouter, Depends, HTTPException, status

from app.domain.models import User, DashboardLayout
from app.domain.schemas import DashboardLayoutCreate, DashboardLayoutUpdate, DashboardLayoutResponse
from app.api.dependencies import get_layout_repository, get_audit_repository, require_csrf, require_feature
from app.repositories.layout_repository import LayoutRepository
from app.repositories.audit_repository import AuditLogRepository

router = APIRouter(prefix="/layouts", tags=["layouts"])


@router.get("", response_model=List[DashboardLayoutResponse])
async def list_layouts(
    current_user: User = Depends(require_feature("serverLayouts")),
    layout_repo: LayoutRepository = Depends(get_layout_repository)
):
    layouts = await layout_repo.list_for_user(current_user.id)
    return layouts


@router.post("", response_model=DashboardLayoutResponse, status_code=201)
async def create_layout(
    req: DashboardLayoutCreate,
    current_user: User = Depends(require_feature("serverLayouts")),
    csrf_protected: None = Depends(require_csrf),
    layout_repo: LayoutRepository = Depends(get_layout_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository)
):
    layout_obj = DashboardLayout(
        name=req.name[:191],
        layout=req.layout,
        userId=current_user.id
    )
    created = await layout_repo.create(layout_obj)
    await audit_repo.log_action("CREATE_LAYOUT", user_id=current_user.id, details={"layoutId": created.id, "name": created.name})
    return created


@router.put("/{id}", response_model=DashboardLayoutResponse)
async def update_layout(
    id: str,
    req: DashboardLayoutUpdate,
    current_user: User = Depends(require_feature("serverLayouts")),
    csrf_protected: None = Depends(require_csrf),
    layout_repo: LayoutRepository = Depends(get_layout_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository)
):
    layout = await layout_repo.get_user_layout(id, current_user.id)
    if not layout:
        raise HTTPException(status_code=404, detail="Layout not found")

    updated = await layout_repo.update_if_version(
        id,
        current_user.id,
        req.version,
        name=req.name,
        layout=req.layout,
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This layout changed in another session. Reload it before saving again.",
        )
    await audit_repo.log_action("UPDATE_LAYOUT", user_id=current_user.id, details={"layoutId": id, "name": updated.name})
    return updated


@router.delete("/{id}")
async def delete_layout(
    id: str,
    current_user: User = Depends(require_feature("serverLayouts")),
    csrf_protected: None = Depends(require_csrf),
    layout_repo: LayoutRepository = Depends(get_layout_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository)
):
    layout = await layout_repo.get_user_layout(id, current_user.id)
    if not layout:
        raise HTTPException(status_code=404, detail="Layout not found")

    await layout_repo.delete(layout)
    await audit_repo.log_action("DELETE_LAYOUT", user_id=current_user.id, details={"layoutId": id, "name": layout.name})
    return {"message": "Layout deleted successfully"}

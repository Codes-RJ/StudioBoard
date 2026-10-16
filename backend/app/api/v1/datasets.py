import json
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, UploadFile, File, Form, Query, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.limiter import limiter
from app.domain.models import User, Dataset
from app.domain.schemas import DatasetResponse, DatasetListResponse, ExportRequest
from app.api.dependencies import get_audit_repository, get_current_user, get_dataset_service, get_dataset_repository, require_csrf, require_feature
from app.services.dataset_service import DatasetService
from app.repositories.dataset_repository import DatasetRepository
from app.repositories.audit_repository import AuditLogRepository
from app.services.analytics.engine import analytics_engine
from app.services.layout_planner import layout_planner
from app.services.result_limits import enforce_export_limit

router = APIRouter(prefix="/datasets", tags=["datasets"])


async def audit_cross_owner_access(
    action: str,
    current_user: User,
    dataset: Dataset,
    audit_repo: AuditLogRepository,
) -> None:
    """Retain an explicit audit record when an admin opens another user's data."""
    if current_user.role == "ADMIN" and dataset.userId != current_user.id:
        await audit_repo.log_action(
            action,
            user_id=current_user.id,
            details={"datasetId": dataset.id, "datasetOwnerId": dataset.userId, "datasetName": dataset.name},
        )


@router.post("/upload", response_model=DatasetResponse, status_code=201)
@limiter.limit("30/minute")
async def upload_dataset(
    request: Request,
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    current_user: User = Depends(require_feature("serverWorkspace")),
    csrf_protected: None = Depends(require_csrf),
    dataset_service: DatasetService = Depends(get_dataset_service)
):
    dataset = await dataset_service.upload_dataset(
        user=current_user,
        file=file,
        name=name,
        description=description
    )
    return dataset


@router.get("", response_model=DatasetListResponse)
async def list_datasets(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    current_user: User = Depends(require_feature("serverWorkspace")),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository)
):
    skip = (page - 1) * limit
    is_admin = current_user.role == "ADMIN"
    items, total = await dataset_repo.list_for_user(
        user_id=current_user.id,
        is_admin=is_admin,
        skip=skip,
        limit=limit
    )

    pages_count = (total + limit - 1) // limit if total > 0 else 0

    return DatasetListResponse(
        datasets=[DatasetResponse.model_validate(item) for item in items],
        pagination={
            "page": page,
            "limit": limit,
            "total": total,
            "pages": pages_count
        }
    )


@router.get("/{id}", response_model=DatasetResponse)
async def get_dataset(
    id: str,
    current_user: User = Depends(require_feature("serverWorkspace")),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository),
):
    is_admin = current_user.role == "ADMIN"
    dataset = await dataset_repo.get_accessible_dataset(id, user_id=current_user.id, is_admin=is_admin)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    await audit_cross_owner_access("ADMIN_DATASET_METADATA_READ", current_user, dataset, audit_repo)
    return dataset


@router.get("/{id}/layout-plan")
async def get_dataset_layout_plan(
    id: str,
    current_user: User = Depends(require_feature("serverAnalytics")),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    dataset_service: DatasetService = Depends(get_dataset_service)
):
    is_admin = current_user.role == "ADMIN"
    dataset = await dataset_repo.get_accessible_dataset(id, user_id=current_user.id, is_admin=is_admin)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    snapshot = await dataset_service.get_live_snapshot(dataset)
    plan = layout_planner.plan_layout(dataset.id, snapshot)
    return plan


@router.delete("/{id}")
async def delete_dataset(
    id: str,
    current_user: User = Depends(require_feature("serverWorkspace")),
    csrf_protected: None = Depends(require_csrf),
    dataset_service: DatasetService = Depends(get_dataset_service)
):
    await dataset_service.delete_dataset(id, current_user)
    return {"message": "Dataset deleted successfully"}


@router.get("/{id}/data")
async def get_dataset_data(
    id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    sort: Optional[str] = Query(None),
    order: Optional[str] = Query("asc"),
    filters: Optional[str] = Query(None),
    current_user: User = Depends(require_feature("serverWorkspace")),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository),
):
    is_admin = current_user.role == "ADMIN"
    dataset = await dataset_repo.get_accessible_dataset(id, user_id=current_user.id, is_admin=is_admin)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    await audit_cross_owner_access("ADMIN_DATASET_DATA_READ", current_user, dataset, audit_repo)

    parsed_filters: Dict[str, Any] = {}
    if filters:
        try:
            parsed_filters = json.loads(filters) if isinstance(filters, str) else filters
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="filters must be a JSON object")
    if not isinstance(parsed_filters, dict) or len(parsed_filters) > 20:
        raise HTTPException(status_code=400, detail="filters must contain at most 20 fields")
    if any(len(str(key)) > 191 or len(str(value)) > 200 for key, value in parsed_filters.items()):
        raise HTTPException(status_code=400, detail="filter values are too long")

    data_payload = await analytics_engine.get_paginated_data(
        file_path=dataset.filePath,
        page=page,
        limit=limit,
        sort=sort,
        order=order,
        filters=parsed_filters
    )
    return data_payload


@router.post("/{id}/export")
async def export_dataset(
    id: str,
    req: ExportRequest,
    current_user: User = Depends(require_feature("serverExports")),
    csrf_protected: None = Depends(require_csrf),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository),
):
    is_admin = current_user.role == "ADMIN"
    dataset = await dataset_repo.get_accessible_dataset(id, user_id=current_user.id, is_admin=is_admin)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    await audit_cross_owner_access("ADMIN_DATASET_EXPORT", current_user, dataset, audit_repo)

    buffer, media_type, ext = await analytics_engine.execute_strategy(
        "export",
        dataset.filePath,
        {"format": req.format},
    )
    enforce_export_limit(buffer.getbuffer().nbytes, background=False)

    return StreamingResponse(
        buffer,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename=export.{ext}"}
    )


@router.post("/{id}/refresh-metadata", response_model=DatasetResponse)
async def refresh_dataset_metadata(
    id: str,
    current_user: User = Depends(require_feature("serverWorkspace")),
    csrf_protected: None = Depends(require_csrf),
    dataset_service: DatasetService = Depends(get_dataset_service)
):
    updated = await dataset_service.refresh_metadata(id, current_user)
    return updated

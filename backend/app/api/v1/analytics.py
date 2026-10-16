import json
import asyncio
import logging
import os
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from app.domain.models import User
from app.domain.schemas import (
    AnalyticsColumnsRequest,
    CorrelationRequest,
    MissingValuesRequest,
    OutlierRequest,
    PivotRequest,
    RegressionRequest,
    TimeSeriesRequest,
    AnalyticsJobCreate,
    AnalyticsJobResponse,
    ExportJobCreate,
)
from app.api.dependencies import get_analytics_job_repository, get_current_user, get_dataset_repository, get_dataset_service, get_audit_repository, require_csrf, require_feature
from app.repositories.dataset_repository import DatasetRepository
from app.repositories.audit_repository import AuditLogRepository
from app.repositories.analytics_job_repository import AnalyticsJobRepository
from app.domain.models import AnalyticsJob
from app.services.dataset_service import DatasetService
from app.services.analytics.engine import analytics_engine
from app.services.result_limits import enforce_interactive_result_limit
from app.core.config import settings

router = APIRouter(prefix="/analytics", tags=["analytics"])
logger = logging.getLogger(__name__)
live_connection_limiter = asyncio.Semaphore(settings.LIVE_MAX_CONNECTIONS)

JOB_PARAMETER_MODELS = {
    "statistics": AnalyticsColumnsRequest,
    "correlation": CorrelationRequest,
    "regression": RegressionRequest,
    "pivot": PivotRequest,
    "timeseries": TimeSeriesRequest,
    "outliers": OutlierRequest,
    "missing": MissingValuesRequest,
}


async def forward_to_strategy(strategy_name: str, payload: Any, user: User, dataset_repo: DatasetRepository, audit_repo: AuditLogRepository):
    # SECURITY: only server-resolved dataset paths may be analyzed. A
    # client-supplied "file_path" would allow arbitrary file reads off disk.
    params = payload.model_dump()
    dataset_id = params["datasetId"]

    is_admin = user.role == "ADMIN"
    dataset = await dataset_repo.get_accessible_dataset(dataset_id, user_id=user.id, is_admin=is_admin)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    file_path = dataset.filePath

    result = enforce_interactive_result_limit(
        await analytics_engine.execute_strategy(strategy_name, file_path, params)
    )
    
    await audit_repo.log_action(
        f"ANALYTICS_{strategy_name.upper()}",
        user_id=user.id,
        details={
            "datasetId": dataset_id,
            "datasetOwnerId": dataset.userId,
            "strategy": strategy_name,
            "crossOwnerAdminAccess": user.role == "ADMIN" and dataset.userId != user.id,
        }
    )
    return result


@router.post("/jobs", response_model=AnalyticsJobResponse, status_code=202)
async def queue_analytics_job(
    payload: AnalyticsJobCreate,
    current_user: User = Depends(require_feature("serverAnalytics")),
    csrf_protected: None = Depends(require_csrf),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    job_repo: AnalyticsJobRepository = Depends(get_analytics_job_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository),
):
    """Queue costlier analytics work for the durable worker instead of an HTTP request."""
    dataset = await dataset_repo.get_accessible_dataset(
        payload.datasetId, user_id=current_user.id, is_admin=current_user.role == "ADMIN"
    )
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    request_model = JOB_PARAMETER_MODELS[payload.strategy]
    try:
        # The server-resolved dataset always wins; a nested datasetId must not
        # be able to redirect the worker to a different record.
        parameters = request_model.model_validate({**payload.parameters, "datasetId": dataset.id}).model_dump()
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid parameters for {payload.strategy}: {exc}") from exc
    job = await job_repo.create(AnalyticsJob(
        kind="ANALYTICS",
        strategy=payload.strategy,
        parameters=parameters,
        userId=current_user.id,
        datasetId=dataset.id,
    ))
    await audit_repo.log_action("ANALYTICS_JOB_QUEUED", user_id=current_user.id, details={
        "jobId": job.id, "datasetId": dataset.id, "strategy": payload.strategy,
    })
    return job


@router.post("/jobs/export", response_model=AnalyticsJobResponse, status_code=202)
async def queue_export_job(
    payload: ExportJobCreate,
    current_user: User = Depends(require_feature("serverExports")),
    csrf_protected: None = Depends(require_csrf),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    job_repo: AnalyticsJobRepository = Depends(get_analytics_job_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository),
):
    dataset = await dataset_repo.get_accessible_dataset(
        payload.datasetId, user_id=current_user.id, is_admin=current_user.role == "ADMIN"
    )
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    job = await job_repo.create(AnalyticsJob(
        kind="EXPORT", strategy="export", parameters={"format": payload.format},
        userId=current_user.id, datasetId=dataset.id,
    ))
    await audit_repo.log_action("EXPORT_JOB_QUEUED", user_id=current_user.id, details={
        "jobId": job.id, "datasetId": dataset.id, "format": payload.format,
    })
    return job


@router.get("/jobs/{job_id}", response_model=AnalyticsJobResponse)
async def get_analytics_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    job_repo: AnalyticsJobRepository = Depends(get_analytics_job_repository),
):
    job = await job_repo.get_accessible_job(job_id, current_user.id, current_user.role == "ADMIN")
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/jobs/{job_id}/download")
async def download_export_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    job_repo: AnalyticsJobRepository = Depends(get_analytics_job_repository),
):
    job = await job_repo.get_accessible_job(job_id, current_user.id, current_user.role == "ADMIN")
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.kind != "EXPORT" or job.status != "SUCCEEDED" or not job.outputPath:
        raise HTTPException(status_code=409, detail="Export is not ready")
    if not os.path.isfile(job.outputPath):
        raise HTTPException(status_code=410, detail="Export has expired")
    extension = job.result.get("format", "bin") if isinstance(job.result, dict) else "bin"
    return FileResponse(job.outputPath, media_type=job.outputMimeType, filename=f"export.{extension}")


@router.get("/live/{dataset_id}/snapshot")
async def get_live_snapshot(
    dataset_id: str,
    current_user: User = Depends(require_feature("serverAnalytics")),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    dataset_service: DatasetService = Depends(get_dataset_service)
):
    is_admin = current_user.role == "ADMIN"
    dataset = await dataset_repo.get_accessible_dataset(dataset_id, user_id=current_user.id, is_admin=is_admin)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    snapshot = await dataset_service.get_live_snapshot(dataset)
    return snapshot


@router.get("/live/{dataset_id}/stream")
async def stream_live_analytics(
    dataset_id: str,
    request: Request,
    current_user: User = Depends(require_feature("serverAnalytics")),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    dataset_service: DatasetService = Depends(get_dataset_service)
):
    is_admin = current_user.role == "ADMIN"
    dataset = await dataset_repo.get_accessible_dataset(dataset_id, user_id=current_user.id, is_admin=is_admin)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        await asyncio.wait_for(live_connection_limiter.acquire(), timeout=0.05)
    except TimeoutError as exc:
        raise HTTPException(status_code=429, detail="Too many live analytics connections") from exc

    async def event_generator():
        try:
            # Initial ready event
            yield f"event: ready\ndata: {json.dumps({'datasetId': dataset.id})}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    snapshot = await dataset_service.get_live_snapshot(dataset)
                    yield f"event: snapshot\ndata: {json.dumps(snapshot, allow_nan=False)}\n\n"
                except Exception:
                    logger.exception("Live analytics snapshot failed")
                    yield f"event: error\ndata: {json.dumps({'message': 'Snapshot temporarily unavailable'})}\n\n"
                await asyncio.sleep(8.0)
        finally:
            live_connection_limiter.release()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.post("/descriptive")
async def descriptive_stats(
    payload: AnalyticsColumnsRequest,
    current_user: User = Depends(require_feature("serverAnalytics")),
    csrf_protected: None = Depends(require_csrf),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository)
):
    return await forward_to_strategy("statistics", payload, current_user, dataset_repo, audit_repo)


@router.post("/correlation")
async def correlation_matrix(
    payload: CorrelationRequest,
    current_user: User = Depends(require_feature("serverAnalytics")),
    csrf_protected: None = Depends(require_csrf),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository)
):
    return await forward_to_strategy("correlation", payload, current_user, dataset_repo, audit_repo)


@router.post("/regression")
async def regression_analysis(
    payload: RegressionRequest,
    current_user: User = Depends(require_feature("serverAnalytics")),
    csrf_protected: None = Depends(require_csrf),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository)
):
    return await forward_to_strategy("regression", payload, current_user, dataset_repo, audit_repo)


@router.post("/pivot")
async def pivot_table(
    payload: PivotRequest,
    current_user: User = Depends(require_feature("serverAnalytics")),
    csrf_protected: None = Depends(require_csrf),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository)
):
    return await forward_to_strategy("pivot", payload, current_user, dataset_repo, audit_repo)


@router.post("/timeseries")
async def timeseries_analysis(
    payload: TimeSeriesRequest,
    current_user: User = Depends(require_feature("serverAnalytics")),
    csrf_protected: None = Depends(require_csrf),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository)
):
    return await forward_to_strategy("timeseries", payload, current_user, dataset_repo, audit_repo)


@router.post("/outliers")
async def outlier_detection(
    payload: OutlierRequest,
    current_user: User = Depends(require_feature("serverAnalytics")),
    csrf_protected: None = Depends(require_csrf),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository)
):
    return await forward_to_strategy("outliers", payload, current_user, dataset_repo, audit_repo)


@router.post("/missing")
async def missing_value_handler(
    payload: MissingValuesRequest,
    current_user: User = Depends(require_feature("serverAnalytics")),
    csrf_protected: None = Depends(require_csrf),
    dataset_repo: DatasetRepository = Depends(get_dataset_repository),
    audit_repo: AuditLogRepository = Depends(get_audit_repository)
):
    return await forward_to_strategy("missing", payload, current_user, dataset_repo, audit_repo)

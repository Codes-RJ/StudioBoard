"""Execution service for database-backed analytics and export jobs."""

import logging
import os
import asyncio
from pathlib import Path

from fastapi import HTTPException

from app.domain.models import AnalyticsJob
from app.core.storage_leases import storage_artifact_lease
from app.repositories.analytics_job_repository import AnalyticsJobRepository
from app.repositories.dataset_repository import DatasetRepository
from app.services.analytics.engine import analytics_engine
from app.services.dataset_service import resolve_upload_directory
from app.services.result_limits import enforce_export_limit, enforce_job_result_limit

logger = logging.getLogger(__name__)


async def _settle_task(awaitable):
    """Drain an owned side effect before releasing its file/database lease."""
    task = asyncio.create_task(awaitable)
    cancellation = None
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError as error:
            cancellation = error
    return await task, cancellation


class AnalyticsJobService:
    def __init__(self, jobs: AnalyticsJobRepository, datasets: DatasetRepository):
        self.jobs = jobs
        self.datasets = datasets

    async def _finish(self, job: AnalyticsJob, **fields) -> bool:
        async def publish():
            async with self.jobs.session.begin():
                published = await self.jobs.finish_attempt(job.id, job.attempts, **fields)
            if not published and fields.get("output_path"):
                # Attempt filenames are exclusive to this writer. Never remove
                # an artifact belonging to another attempt or a legacy path.
                await asyncio.to_thread(Path(fields["output_path"]).unlink, missing_ok=True)
            return published
        published, cancellation = await _settle_task(publish())
        if cancellation is not None:
            raise cancellation
        return published

    async def execute(self, job: AnalyticsJob) -> bool:
        """Compute outside transactions, then publish only for an owned lease."""
        try:
            async with self.jobs.session.begin():
                dataset = await self.datasets.get_by_id(job.datasetId) if job.datasetId else None
                file_path = dataset.filePath if dataset else None
            if not file_path or not Path(file_path).is_file():
                return await self._finish(job, status="FAILED", error="The source dataset is no longer available.")
            if job.kind == "EXPORT":
                buffer, mime_type, extension = await analytics_engine.execute_strategy(
                    "export", file_path, job.parameters
                )
                enforce_export_limit(buffer.getbuffer().nbytes, background=True)
                destination = self._export_path(job.id, job.attempts, extension)
                async with storage_artifact_lease(Path(resolve_upload_directory()), destination):
                    output_path, cancellation = await _settle_task(analytics_engine.execute_blocking_task(
                        self._write_export, job.id, job.attempts, extension, buffer.getvalue()
                    ))
                    if cancellation is not None:
                        await asyncio.to_thread(Path(output_path).unlink, missing_ok=True)
                        raise cancellation
                    return await self._finish(
                        job, status="SUCCEEDED", output_path=output_path, output_mime_type=mime_type,
                        result={"downloadReady": True, "format": extension},
                    )
            result = enforce_job_result_limit(
                await analytics_engine.execute_strategy(job.strategy, file_path, job.parameters)
            )
            return await self._finish(job, status="SUCCEEDED", result=result)
        except HTTPException as exc:
            return await self._finish(job, status="FAILED", error=str(exc.detail)[:1000])
        except Exception:
            logger.exception("Analytics job failed", extra={"jobId": job.id})
            return await self._finish(job, status="FAILED", error="The job failed unexpectedly. Check the server logs using the job ID.")

    @staticmethod
    def _export_path(job_id: str, attempt: int, extension: str) -> Path:
        return Path(resolve_upload_directory()) / "exports" / f"{job_id}.attempt-{attempt}.{extension}"

    @staticmethod
    def _write_export(job_id: str, attempt: int, extension: str, content: bytes) -> str:
        destination = AnalyticsJobService._export_path(job_id, attempt, extension)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(f".{extension}.part")
        try:
            temporary.write_bytes(content)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        return str(destination.resolve())

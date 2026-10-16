"""Database access for durable analytics work items."""

from datetime import timedelta
from typing import Optional

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models import AnalyticsJob, utc_now
from app.core.config import settings
from app.repositories.base import BaseRepository


class AnalyticsJobRepository(BaseRepository[AnalyticsJob]):
    def __init__(self, session: AsyncSession):
        super().__init__(session, AnalyticsJob)

    async def get_accessible_job(self, job_id: str, user_id: str, is_admin: bool) -> Optional[AnalyticsJob]:
        query = select(AnalyticsJob).where(AnalyticsJob.id == job_id)
        if not is_admin:
            query = query.where(AnalyticsJob.userId == user_id)
        return (await self.session.execute(query)).scalar_one_or_none()

    async def claim_next(self) -> Optional[AnalyticsJob]:
        """Claim one queued item under a row lock; safe with multiple workers on MySQL."""
        query = (
            select(AnalyticsJob)
            .where(AnalyticsJob.status == "QUEUED")
            .order_by(AnalyticsJob.createdAt.asc())
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        job = (await self.session.execute(query)).scalar_one_or_none()
        if not job:
            return None
        now = utc_now()
        claimed = await self.session.execute(
            update(AnalyticsJob)
            .where(AnalyticsJob.id == job.id, AnalyticsJob.status == "QUEUED", AnalyticsJob.attempts == job.attempts)
            .values(status="RUNNING", error=None, startedAt=now, completedAt=None,
                    leaseExpiresAt=now + timedelta(seconds=settings.JOB_STALE_AFTER_SECONDS),
                    attempts=AnalyticsJob.attempts + 1)
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != 1:
            return None
        await self.session.refresh(job)
        return job

    @staticmethod
    def _attempt_conditions(job_id: str, attempt: int):
        return (
            AnalyticsJob.id == job_id, AnalyticsJob.status == "RUNNING",
            AnalyticsJob.attempts == attempt, AnalyticsJob.leaseExpiresAt > utc_now(),
        )

    async def renew_attempt(self, job_id: str, attempt: int, lease_seconds: int) -> bool:
        result = await self.session.execute(
            update(AnalyticsJob).where(*self._attempt_conditions(job_id, attempt))
            .values(leaseExpiresAt=utc_now() + timedelta(seconds=lease_seconds))
            .execution_options(synchronize_session=False)
        )
        return result.rowcount == 1

    async def finish_attempt(
        self, job_id: str, attempt: int, *, status: str, result=None,
        error: Optional[str] = None, output_path: Optional[str] = None, output_mime_type: Optional[str] = None,
    ) -> bool:
        if status not in {"SUCCEEDED", "FAILED"}:
            raise ValueError("An attempt must finish as SUCCEEDED or FAILED")
        updated = await self.session.execute(
            update(AnalyticsJob).where(*self._attempt_conditions(job_id, attempt))
            .values(status=status, result=result, error=error, outputPath=output_path,
                    outputMimeType=output_mime_type, completedAt=utc_now(), leaseExpiresAt=None)
            .execution_options(synchronize_session=False)
        )
        return updated.rowcount == 1

    async def recover_stale_jobs(self, stale_after_seconds: int, max_attempts: int) -> int:
        now = utc_now()
        cutoff = now - timedelta(seconds=stale_after_seconds)
        result = await self.session.execute(
            update(AnalyticsJob)
            .where(AnalyticsJob.status == "RUNNING", or_(
                AnalyticsJob.leaseExpiresAt <= now,
                and_(AnalyticsJob.leaseExpiresAt.is_(None), AnalyticsJob.startedAt < cutoff),
            ))
            .values(status="QUEUED", startedAt=None, leaseExpiresAt=None, error="Worker lease expired; job requeued")
        )
        await self.session.execute(
            update(AnalyticsJob)
            .where(AnalyticsJob.status == "QUEUED", AnalyticsJob.attempts >= max_attempts)
            .values(status="FAILED", completedAt=utc_now(), error="Maximum worker attempts exceeded")
        )
        return result.rowcount or 0

    async def list_expired_completed(self, completed_before) -> list[AnalyticsJob]:
        result = await self.session.execute(
            select(AnalyticsJob).where(
                AnalyticsJob.status.in_(("SUCCEEDED", "FAILED")),
                AnalyticsJob.completedAt.is_not(None),
                AnalyticsJob.completedAt < completed_before,
            )
        )
        return list(result.scalars().all())

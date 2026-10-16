"""Standalone durable analytics worker. Run one or more replicas beside the API."""

import asyncio
import logging
import time

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.core.role_health import publish_role_heartbeat, role_heartbeat_loop, stop_heartbeat_task
from app.repositories.analytics_job_repository import AnalyticsJobRepository
from app.repositories.dataset_repository import DatasetRepository
from app.services.analytics_job_service import AnalyticsJobService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("analytics_worker")


async def renew_attempt_loop(job_id: str, attempt: int) -> None:
    interval = max(0.05, settings.JOB_STALE_AFTER_SECONDS / 3)
    while True:
        await asyncio.sleep(interval)
        try:
            async with AsyncSessionLocal() as session, session.begin():
                renewed = await AnalyticsJobRepository(session).renew_attempt(
                    job_id, attempt, settings.JOB_STALE_AFTER_SECONDS
                )
            if not renewed:
                logger.warning("analytics_job_lease_lost id=%s attempt=%s", job_id, attempt)
                return
        except Exception:
            logger.exception("analytics_job_lease_renewal_failed id=%s attempt=%s", job_id, attempt)
            return


async def claim_and_run_once() -> bool:
    async with AsyncSessionLocal() as session:
        async with session.begin():
            repository = AnalyticsJobRepository(session)
            job = await repository.claim_next()
        if not job:
            return False

        renewal = asyncio.create_task(renew_attempt_loop(job.id, job.attempts))
        try:
            service = AnalyticsJobService(repository, DatasetRepository(session))
            published = await service.execute(job)
        finally:
            renewal.cancel()
            try:
                await renewal
            except asyncio.CancelledError:
                pass
        logger.info("analytics_job_finished id=%s published=%s attempt=%s", job.id, published, job.attempts)
        return True


async def run() -> None:
    logger.info("Analytics job worker started")
    heartbeat_task = asyncio.create_task(role_heartbeat_loop("worker"))
    try:
        while True:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    requeued = await AnalyticsJobRepository(session).recover_stale_jobs(
                        settings.JOB_STALE_AFTER_SECONDS, settings.JOB_MAX_ATTEMPTS
                    )
                    if requeued:
                        logger.warning("Requeued %s stale analytics jobs", requeued)
            found_work = await claim_and_run_once()
            if found_work:
                await publish_role_heartbeat("worker", last_success=time.time())
            if not found_work:
                await asyncio.sleep(settings.JOB_WORKER_POLL_SECONDS)
    finally:
        await stop_heartbeat_task(heartbeat_task)
        await engine.dispose()


if __name__ == "__main__":
    if not settings.ALLOW_SERVER_WORKSPACE:
        raise SystemExit("Server worker is disabled in browser-only mode.")
    asyncio.run(run())

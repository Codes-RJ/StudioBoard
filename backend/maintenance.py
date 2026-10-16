"""Periodic non-destructive maintenance for uploads and completed job artifacts."""

import argparse
import asyncio
import logging
import time
from datetime import timedelta
from pathlib import Path

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.core.role_health import publish_role_heartbeat, role_heartbeat_loop, stop_heartbeat_task
from app.domain.models import utc_now
from app.repositories.analytics_job_repository import AnalyticsJobRepository
from reconcile_storage import reconcile_storage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("maintenance")


async def cleanup_expired_job_artifacts() -> int:
    """Delete only completed/expired job output files and their database records."""
    cutoff = utc_now() - timedelta(hours=settings.JOB_RESULT_RETENTION_HOURS)
    removed_jobs = 0
    async with AsyncSessionLocal() as session:
        async with session.begin():
            jobs = await AnalyticsJobRepository(session).list_expired_completed(cutoff)
            for job in jobs:
                if job.outputPath:
                    try:
                        Path(job.outputPath).unlink(missing_ok=True)
                    except OSError:
                        logger.warning("Unable to delete expired job artifact %s", job.outputPath)
                        continue
                await session.delete(job)
                removed_jobs += 1
    return removed_jobs


async def run_once(delete_orphans: bool) -> None:
    orphaned, missing = await reconcile_storage(delete_orphans=delete_orphans)
    removed_jobs = await cleanup_expired_job_artifacts()
    logger.info("Maintenance completed orphaned=%s missing=%s expired_jobs=%s", len(orphaned), len(missing), removed_jobs)
    await publish_role_heartbeat("maintenance", last_success=time.time())


async def run(interval_seconds: int, delete_orphans: bool) -> None:
    heartbeat_task = asyncio.create_task(role_heartbeat_loop("maintenance"))
    try:
        while True:
            await run_once(delete_orphans)
            await asyncio.sleep(interval_seconds)
    finally:
        await stop_heartbeat_task(heartbeat_task)
        await engine.dispose()


if __name__ == "__main__":
    if not settings.ALLOW_SERVER_WORKSPACE:
        raise SystemExit("Server maintenance is disabled in browser-only mode.")
    parser = argparse.ArgumentParser(description="Run scheduled storage and job-artifact maintenance.")
    parser.add_argument("--once", action="store_true", help="run one pass and exit")
    parser.add_argument("--interval-seconds", type=int, default=settings.STORAGE_RECONCILE_INTERVAL_SECONDS)
    parser.add_argument("--delete-orphans", action="store_true", help="remove upload files with no database record")
    args = parser.parse_args()
    if args.once:
        asyncio.run(run_once(args.delete_orphans))
    else:
        asyncio.run(run(max(300, args.interval_seconds), args.delete_orphans))

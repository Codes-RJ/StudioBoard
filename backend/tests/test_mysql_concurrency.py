import os
from uuid import uuid4

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.domain.models import AnalyticsJob, User
from app.repositories.analytics_job_repository import AnalyticsJobRepository


MYSQL_INTEGRATION_DATABASE_URL = os.environ.get("MYSQL_INTEGRATION_DATABASE_URL")


@pytest.mark.asyncio
@pytest.mark.skipif(not MYSQL_INTEGRATION_DATABASE_URL, reason="requires the MySQL integration database")
async def test_mysql_workers_skip_each_others_locked_jobs():
    engine = create_async_engine(MYSQL_INTEGRATION_DATABASE_URL, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    suffix = uuid4().hex
    user_id = None

    try:
        async with sessions() as setup_session, setup_session.begin():
            user = User(email=f"worker-race-{suffix}@example.com", password="unused", role="USER")
            setup_session.add(user)
            await setup_session.flush()
            user_id = user.id
            setup_session.add_all([
                AnalyticsJob(kind="ANALYTICS", strategy="statistics", status="QUEUED", parameters={}, userId=user.id),
                AnalyticsJob(kind="ANALYTICS", strategy="statistics", status="QUEUED", parameters={}, userId=user.id),
            ])

        async with sessions() as first_session, sessions() as second_session:
            first_transaction = await first_session.begin()
            first = await AnalyticsJobRepository(first_session).claim_next()

            async with second_session.begin():
                second = await AnalyticsJobRepository(second_session).claim_next()

            await first_transaction.commit()

        assert first is not None
        assert second is not None
        assert first.id != second.id
        assert first.status == "RUNNING"
        assert second.status == "RUNNING"
    finally:
        if user_id:
            async with sessions() as cleanup_session, cleanup_session.begin():
                await cleanup_session.execute(delete(AnalyticsJob).where(AnalyticsJob.userId == user_id))
                await cleanup_session.execute(delete(User).where(User.id == user_id))
        await engine.dispose()

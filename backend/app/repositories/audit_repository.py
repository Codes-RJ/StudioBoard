from typing import Optional, List, Tuple, Any, Dict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from app.domain.models import Log
from app.repositories.base import BaseRepository


class AuditLogRepository(BaseRepository[Log]):
    def __init__(self, session: AsyncSession):
        super().__init__(session, Log)

    async def log_action(
        self,
        action: str,
        user_id: Optional[str] = None,
        dataset_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None
    ) -> Log:
        log_entry = Log(
            action=action,
            userId=user_id,
            datasetId=dataset_id,
            details=details
        )
        self.session.add(log_entry)
        await self.session.flush()
        await self.session.refresh(log_entry)
        return log_entry

    async def list_recent_logs(self, limit: int = 12) -> List[Log]:
        result = await self.session.execute(
            select(Log)
            .options(selectinload(Log.user), selectinload(Log.dataset))
            .order_by(Log.createdAt.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def list_logs_paginated(self, skip: int = 0, limit: int = 50) -> Tuple[List[Log], int]:
        items_result = await self.session.execute(
            select(Log)
            .options(selectinload(Log.user), selectinload(Log.dataset))
            .order_by(Log.createdAt.desc())
            .offset(skip)
            .limit(limit)
        )
        count_result = await self.session.execute(select(func.count()).select_from(Log))
        return list(items_result.scalars().all()), (count_result.scalar() or 0)

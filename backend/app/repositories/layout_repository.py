from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.domain.models import DashboardLayout
from app.domain.models import utc_now
from app.repositories.base import BaseRepository


class LayoutRepository(BaseRepository[DashboardLayout]):
    def __init__(self, session: AsyncSession):
        super().__init__(session, DashboardLayout)

    async def list_for_user(self, user_id: str) -> List[DashboardLayout]:
        result = await self.session.execute(
            select(DashboardLayout).where(DashboardLayout.userId == user_id).order_by(DashboardLayout.createdAt.desc())
        )
        return list(result.scalars().all())

    async def get_user_layout(self, layout_id: str, user_id: str) -> Optional[DashboardLayout]:
        result = await self.session.execute(
            select(DashboardLayout).where(DashboardLayout.id == layout_id, DashboardLayout.userId == user_id)
        )
        return result.scalar_one_or_none()

    async def update_if_version(
        self,
        layout_id: str,
        user_id: str,
        expected_version: int,
        *,
        name: Optional[str] = None,
        layout: Optional[List[dict]] = None,
    ) -> Optional[DashboardLayout]:
        values = {
            "version": DashboardLayout.version + 1,
            "updatedAt": utc_now(),
        }
        if name is not None:
            values["name"] = name[:191]
        if layout is not None:
            values["layout"] = layout

        result = await self.session.execute(
            update(DashboardLayout)
            .where(
                DashboardLayout.id == layout_id,
                DashboardLayout.userId == user_id,
                DashboardLayout.version == expected_version,
            )
            .values(**values)
        )
        if result.rowcount != 1:
            return None
        await self.session.flush()
        return await self.get_user_layout(layout_id, user_id)

from typing import Optional, List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from app.domain.models import Dataset
from app.repositories.base import BaseRepository


class DatasetRepository(BaseRepository[Dataset]):
    def __init__(self, session: AsyncSession):
        super().__init__(session, Dataset)

    async def get_accessible_dataset(self, dataset_id: str, user_id: Optional[str] = None, is_admin: bool = False) -> Optional[Dataset]:
        query = select(Dataset).where(Dataset.id == dataset_id).options(selectinload(Dataset.user))
        if not is_admin:
            if not user_id:
                return None
            query = query.where(Dataset.userId == user_id)
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def list_for_user(
        self,
        user_id: Optional[str] = None,
        is_admin: bool = False,
        skip: int = 0,
        limit: int = 10
    ) -> Tuple[List[Dataset], int]:
        query = select(Dataset).options(selectinload(Dataset.user)).order_by(Dataset.createdAt.desc())
        count_query = select(func.count()).select_from(Dataset)

        if not is_admin:
            if not user_id:
                return [], 0
            query = query.where(Dataset.userId == user_id)
            count_query = count_query.where(Dataset.userId == user_id)

        items_result = await self.session.execute(query.offset(skip).limit(limit))
        count_result = await self.session.execute(count_query)

        return list(items_result.scalars().all()), (count_result.scalar() or 0)

    async def get_all_user_filepaths(self, user_id: str, *, current: bool = False) -> List[str]:
        query = select(Dataset.filePath).where(Dataset.userId == user_id)
        if current:
            # MySQL's locking read sees current committed rows even when an
            # earlier authentication query established a repeatable-read view.
            query = query.with_for_update(read=True)
        result = await self.session.execute(query)
        return [row[0] for row in result.all() if row[0]]

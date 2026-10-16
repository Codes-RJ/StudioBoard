from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.domain.models import User
from app.repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    def __init__(self, session: AsyncSession):
        super().__init__(session, User)

    async def get_by_email(self, email: str) -> Optional[User]:
        result = await self.session.execute(
            select(User).where(User.email == email.lower().strip())
        )
        return result.scalar_one_or_none()

    async def list_users_paginated(self, skip: int = 0, limit: int = 20) -> List[User]:
        result = await self.session.execute(
            select(User).order_by(User.createdAt.desc()).offset(skip).limit(limit)
        )
        return list(result.scalars().all())

from typing import Optional, Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.domain.models import SiteConfig
from app.repositories.base import BaseRepository


class SiteConfigRepository(BaseRepository[SiteConfig]):
    def __init__(self, session: AsyncSession):
        super().__init__(session, SiteConfig)

    async def get_by_key(self, key: str) -> Optional[SiteConfig]:
        result = await self.session.execute(
            select(SiteConfig).where(SiteConfig.key == key)
        )
        return result.scalar_one_or_none()

    async def get_all_as_dict(self) -> Dict[str, Any]:
        result = await self.session.execute(select(SiteConfig))
        configs = result.scalars().all()
        config_map = {}
        for item in configs:
            config_map[item.key] = item.value
        return config_map

    async def set_value(self, key: str, value: Any) -> SiteConfig:
        existing = await self.get_by_key(key)
        if existing:
            existing.value = value
            await self.session.flush()
            await self.session.refresh(existing)
            return existing
        else:
            new_item = SiteConfig(key=key, value=value)
            self.session.add(new_item)
            await self.session.flush()
            await self.session.refresh(new_item)
            return new_item

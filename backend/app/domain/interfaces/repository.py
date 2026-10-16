from abc import ABC, abstractmethod
from typing import Generic, TypeVar, Optional, List, Any, Dict

T = TypeVar("T")


class IRepository(Generic[T], ABC):
    """Abstract generic repository interface defining standard CRUD operations."""

    @abstractmethod
    async def get_by_id(self, id: str) -> Optional[T]:
        pass

    @abstractmethod
    async def list_all(self, skip: int = 0, limit: int = 100) -> List[T]:
        pass

    @abstractmethod
    async def create(self, entity: T) -> T:
        pass

    @abstractmethod
    async def update(self, entity: T) -> T:
        pass

    @abstractmethod
    async def delete(self, entity: T) -> None:
        pass

    @abstractmethod
    async def count(self) -> int:
        pass

import json
import logging
import time
from typing import Any, Optional, Dict, List
import redis.asyncio as aioredis
from app.core.config import settings

logger = logging.getLogger("redis_client")


async def ping_redis_url(url: Optional[str]) -> bool:
    """Probe a Redis URL without exposing credentials or reusing app state."""
    if not url or url == "memory://":
        return bool(url)

    client = aioredis.from_url(
        url,
        encoding="utf-8",
        decode_responses=True,
        socket_connect_timeout=2.0,
        socket_timeout=2.0,
    )
    try:
        return bool(await client.ping())
    except Exception:
        return False
    finally:
        await client.aclose()

class RedisClient:
    def __init__(self):
        self._client: Optional[aioredis.Redis] = None
        self._enabled = bool(settings.REDIS_URL)
        self._last_error_log: Dict[str, float] = {}

    def _log_failure(self, operation: str, error: Exception) -> None:
        now = time.monotonic()
        if now - self._last_error_log.get(operation, 0) < 60:
            return
        self._last_error_log[operation] = now
        logger.warning("Redis %s failed; the operation will be retried later: %s", operation, type(error).__name__)

    async def _handle_failure(self, operation: str, error: Exception) -> None:
        self._log_failure(operation, error)
        failed_client = self._client
        self._client = None
        if failed_client is not None:
            try:
                await failed_client.aclose()
            except Exception:
                logger.debug("Redis client cleanup failed after %s", operation, exc_info=True)

    async def close(self) -> None:
        client = self._client
        self._client = None
        if client is not None:
            await client.aclose()

    async def get_client(self) -> Optional[aioredis.Redis]:
        if not self._enabled:
            return None
        if self._client is None and settings.REDIS_URL:
            candidate: Optional[aioredis.Redis] = None
            try:
                candidate = aioredis.from_url(
                    settings.REDIS_URL,
                    encoding="utf-8",
                    decode_responses=True,
                    socket_connect_timeout=2.0
                )
                await candidate.ping()
                self._client = candidate
            except Exception as error:
                if candidate is not None:
                    await candidate.aclose()
                self._client = None
                self._log_failure("connect", error)
        return self._client

    async def get(self, key: str) -> Optional[str]:
        try:
            client = await self.get_client()
            if client:
                return await client.get(key)
        except Exception as error:
            await self._handle_failure("get", error)
        return None

    async def get_json(self, key: str) -> Optional[Any]:
        val = await self.get(key)
        if val:
            try:
                return json.loads(val)
            except (TypeError, ValueError, json.JSONDecodeError):
                logger.warning("Redis key %s contained invalid JSON and was ignored.", key)
                return None
        return None

    async def set(self, key: str, value: str, ex: Optional[int] = None) -> bool:
        try:
            client = await self.get_client()
            if client:
                await client.set(key, value, ex=ex)
                return True
        except Exception as error:
            await self._handle_failure("set", error)
        return False

    async def set_json(self, key: str, value: Any, ex: Optional[int] = None) -> bool:
        try:
            serialized = json.dumps(value)
            return await self.set(key, serialized, ex=ex)
        except (TypeError, ValueError) as error:
            logger.warning("Redis JSON serialization failed: %s", type(error).__name__)
            return False

    async def delete(self, key: str) -> bool:
        try:
            client = await self.get_client()
            if client:
                await client.delete(key)
                return True
        except Exception as error:
            await self._handle_failure("delete", error)
        return False

    async def hincrby(self, key: str, field: str, amount: int = 1) -> Optional[int]:
        try:
            client = await self.get_client()
            if client:
                return await client.hincrby(key, field, amount)
        except Exception as error:
            await self._handle_failure("hincrby", error)
        return None

    async def hgetall(self, key: str) -> Optional[Dict[str, str]]:
        try:
            client = await self.get_client()
            if client:
                return await client.hgetall(key)
        except Exception as error:
            await self._handle_failure("hgetall", error)
        return None

    async def sadd(self, key: str, member: str) -> bool:
        try:
            client = await self.get_client()
            if client:
                await client.sadd(key, member)
                return True
        except Exception as error:
            await self._handle_failure("sadd", error)
        return False

    async def scard(self, key: str) -> Optional[int]:
        try:
            client = await self.get_client()
            if client:
                return await client.scard(key)
        except Exception as error:
            await self._handle_failure("scard", error)
        return None

    async def lpush(self, key: str, value: str, maxlen: int = 500) -> bool:
        try:
            client = await self.get_client()
            if client:
                async with client.pipeline(transaction=True) as pipe:
                    pipe.lpush(key, value)
                    pipe.ltrim(key, 0, maxlen - 1)
                    await pipe.execute()
                return True
        except Exception as error:
            await self._handle_failure("lpush", error)
        return False

    async def lrange_json(self, key: str, start: int = 0, stop: int = -1) -> Optional[List[Any]]:
        try:
            client = await self.get_client()
            if client:
                items = await client.lrange(key, start, stop)
                results = []
                for item in items:
                    try:
                        results.append(json.loads(item))
                    except Exception:
                        results.append(item)
                return results
        except Exception as error:
            await self._handle_failure("lrange", error)
        return None

redis_client = RedisClient()

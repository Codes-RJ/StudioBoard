import asyncio
import time
from contextlib import suppress
from typing import Any, Dict, Optional

from app.core.redis_client import redis_client


ROLE_HEARTBEAT_SECONDS = 30
ROLE_HEARTBEAT_TTL_SECONDS = 180


async def publish_role_heartbeat(role: str, *, last_success: Optional[float] = None) -> bool:
    key = f"health:role:{role}"
    previous = await redis_client.get_json(key) or {}
    payload = {
        "role": role,
        "heartbeat": time.time(),
        "lastSuccess": last_success if last_success is not None else previous.get("lastSuccess"),
    }
    return await redis_client.set_json(key, payload, ex=ROLE_HEARTBEAT_TTL_SECONDS)


async def get_role_health(role: str) -> Optional[Dict[str, Any]]:
    value = await redis_client.get_json(f"health:role:{role}")
    return value if isinstance(value, dict) else None


async def role_heartbeat_loop(role: str) -> None:
    while True:
        await publish_role_heartbeat(role)
        await asyncio.sleep(ROLE_HEARTBEAT_SECONDS)


async def stop_heartbeat_task(task: asyncio.Task) -> None:
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


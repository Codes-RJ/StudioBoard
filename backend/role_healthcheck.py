"""Container health probe for standalone background roles."""

import argparse
import asyncio
import time

from app.core.redis_client import redis_client


async def check(role: str, max_age: int) -> int:
    payload = await redis_client.get_json(f"health:role:{role}")
    heartbeat = payload.get("heartbeat") if isinstance(payload, dict) else None
    if not isinstance(heartbeat, (int, float)):
        return 1
    return 0 if time.time() - heartbeat <= max_age else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("role", choices=("worker", "maintenance"))
    parser.add_argument("--max-age", type=int, default=180)
    args = parser.parse_args()
    raise SystemExit(asyncio.run(check(args.role, args.max_age)))


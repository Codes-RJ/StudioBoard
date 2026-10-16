import time
import hashlib
import hmac
import psutil
import os
import logging
from collections import deque
from typing import Dict, Any, List, Optional

START_TIME = time.time()
RECENT_REQUESTS = deque(maxlen=500)
STATUS_BUCKETS = {"2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0}
UNIQUE_IPS = set()
TOTAL_REQUESTS = 0
PENDING_TELEMETRY_TASKS = set()
# Reuse Uvicorn's general application logger so structured events reach the
# platform collector. The dedicated access logger requires a five-item tuple
# and crashes its formatter when handed an already-serialized JSON event.
logger = logging.getLogger("uvicorn.error")


import asyncio
import json
from app.core.config import settings


def anonymize_client_ip(ip: str) -> str:
    """Create a stable, non-reversible visitor key without retaining raw IPs."""
    if not ip:
        return ""
    key = settings.JWT_SECRET.encode("utf-8")
    return hmac.new(key, ip.encode("utf-8"), hashlib.sha256).hexdigest()[:20]

def track_request(method: str, path: str, ip: str, status_code: int, duration_ms: float, request_id: str) -> None:
    global TOTAL_REQUESTS
    TOTAL_REQUESTS += 1
    
    client_id = anonymize_client_ip(ip)
    if client_id and len(UNIQUE_IPS) < settings.TELEMETRY_MAX_UNIQUE_IPS:
        UNIQUE_IPS.add(client_id)
        
    bucket = None
    if 200 <= status_code < 300:
        STATUS_BUCKETS["2xx"] += 1
        bucket = "2xx"
    elif 300 <= status_code < 400:
        STATUS_BUCKETS["3xx"] += 1
        bucket = "3xx"
    elif 400 <= status_code < 500:
        STATUS_BUCKETS["4xx"] += 1
        bucket = "4xx"
    elif status_code >= 500:
        STATUS_BUCKETS["5xx"] += 1
        bucket = "5xx"

    req_entry = {
        "timestamp": time.time(),
        "method": method,
        "path": path,
        "clientId": client_id,
        "statusCode": status_code,
        "durationMs": round(duration_ms, 2)
    }
    RECENT_REQUESTS.append(req_entry)
    logger.info(json.dumps({"event": "http_request", "requestId": request_id, **req_entry}))

    # Best-effort async push to Redis if event loop is running
    try:
        from app.core.redis_client import redis_client
        loop = asyncio.get_running_loop()
        task = loop.create_task(_async_redis_track(redis_client, client_id, bucket, req_entry))
        PENDING_TELEMETRY_TASKS.add(task)
        task.add_done_callback(PENDING_TELEMETRY_TASKS.discard)
    except RuntimeError:
        logger.debug("Telemetry event loop was unavailable.", exc_info=True)


async def _async_redis_track(client, client_id: str, bucket: Optional[str], entry: Dict[str, Any]) -> None:
    try:
        await client.hincrby("telemetry:counters", "total", 1)
        if bucket:
            await client.hincrby("telemetry:counters", bucket, 1)
        if client_id:
            await client.sadd("telemetry:unique_ips", client_id)
        await client.lpush("telemetry:recent_requests", json.dumps(entry), maxlen=500)
    except Exception:
        logger.warning("Redis telemetry write failed.", exc_info=True)


async def flush_telemetry_tasks(timeout_seconds: float = 2.0) -> None:
    if not PENDING_TELEMETRY_TASKS:
        return
    pending = list(PENDING_TELEMETRY_TASKS)
    try:
        await asyncio.wait_for(asyncio.gather(*pending, return_exceptions=True), timeout=timeout_seconds)
    except TimeoutError:
        for task in pending:
            task.cancel()


def get_traffic_snapshot() -> Dict[str, Any]:
    now = time.time()
    five_min_ago = now - 300
    
    recent_5m = [r for r in RECENT_REQUESTS if r["timestamp"] >= five_min_ago]
    
    # Minute buckets for the chart
    buckets = {}
    for i in range(15):
        bucket_time = now - (14 - i) * 60
        time_str = time.strftime("%H:%M", time.localtime(bucket_time))
        buckets[time_str] = 0
        
    for req in RECENT_REQUESTS:
        if req["timestamp"] >= now - 900:
            time_str = time.strftime("%H:%M", time.localtime(req["timestamp"]))
            if time_str in buckets:
                buckets[time_str] += 1
                
    chart_series = [{"time": k, "requests": v} for k, v in buckets.items()]

    return {
        "totalRequests": TOTAL_REQUESTS,
        "uniqueIps": len(UNIQUE_IPS),
        "uptimeSeconds": int(now - START_TIME),
        "statusBuckets": STATUS_BUCKETS,
        "recent5m": {
            "count": len(recent_5m),
            "entries": recent_5m[-20:]
        },
        "minuteBuckets": chart_series
    }


def get_system_metrics() -> Dict[str, Any]:
    process = psutil.Process(os.getpid())
    memory_info = process.memory_info()
    
    return {
        "cpuUsage": int(psutil.cpu_percent(interval=None)),
        "memoryUsage": int(process.memory_percent()),
        "memoryUsedMb": int(memory_info.rss / 1024 / 1024),
        "uptimeSeconds": int(time.time() - START_TIME)
    }


def render_prometheus_metrics(job_counts: Optional[Dict[str, int]] = None) -> str:
    """Expose low-cardinality OpenMetrics without a vendor-specific SDK."""
    lines = [
        "# HELP analytics_http_requests_total HTTP requests handled by this process.",
        "# TYPE analytics_http_requests_total counter",
        f"analytics_http_requests_total {TOTAL_REQUESTS}",
        "# HELP analytics_http_responses_total HTTP responses grouped by status family.",
        "# TYPE analytics_http_responses_total counter",
    ]
    lines.extend(
        f'analytics_http_responses_total{{status_family="{family}"}} {count}'
        for family, count in STATUS_BUCKETS.items()
    )
    lines.extend([
        "# HELP analytics_process_uptime_seconds Uptime of this API process.",
        "# TYPE analytics_process_uptime_seconds gauge",
        f"analytics_process_uptime_seconds {int(time.time() - START_TIME)}",
        "# HELP analytics_known_client_ips Number of distinct client IPs retained in memory.",
        "# TYPE analytics_known_client_ips gauge",
        f"analytics_known_client_ips {len(UNIQUE_IPS)}",
        "# HELP analytics_jobs Number of durable analytics jobs grouped by status.",
        "# TYPE analytics_jobs gauge",
    ])
    for status, count in (job_counts or {}).items():
        lines.append(f'analytics_jobs{{status="{status}"}} {count}')
    return "\n".join(lines) + "\n"

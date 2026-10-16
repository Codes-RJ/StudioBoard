import json
from typing import Any

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder

from app.core.config import settings


def serialized_json_size(value: Any) -> int:
    encoded = jsonable_encoder(value)
    return len(json.dumps(encoded, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def result_too_large_detail(*, actual_bytes: int, maximum_bytes: int, recommendation: str) -> dict:
    return {
        "code": "RESULT_TOO_LARGE",
        "message": "The analytics result exceeds the configured response limit.",
        "actualBytes": actual_bytes,
        "maximumBytes": maximum_bytes,
        "recommendation": recommendation,
    }


def enforce_interactive_result_limit(value: Any) -> Any:
    actual_bytes = serialized_json_size(value)
    if actual_bytes > settings.ANALYTICS_MAX_RESPONSE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=result_too_large_detail(
                actual_bytes=actual_bytes,
                maximum_bytes=settings.ANALYTICS_MAX_RESPONSE_BYTES,
                recommendation="Submit the analysis as a background job or narrow the requested columns.",
            ),
        )
    return value


def enforce_job_result_limit(value: Any) -> Any:
    actual_bytes = serialized_json_size(value)
    if actual_bytes > settings.JOB_MAX_RESULT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=result_too_large_detail(
                actual_bytes=actual_bytes,
                maximum_bytes=settings.JOB_MAX_RESULT_BYTES,
                recommendation="Narrow the analysis or export the underlying dataset instead.",
            ),
        )
    return value


def enforce_export_limit(actual_bytes: int, *, background: bool) -> None:
    maximum_bytes = settings.JOB_MAX_ARTIFACT_BYTES if background else settings.INTERACTIVE_EXPORT_MAX_BYTES
    if actual_bytes > maximum_bytes:
        recommendation = (
            "Reduce the source dataset or increase the configured artifact quota."
            if background
            else "Submit this export through the background-job endpoint."
        )
        raise HTTPException(
            status_code=413,
            detail={
                "code": "EXPORT_TOO_LARGE",
                "message": "The generated export exceeds the configured size limit.",
                "actualBytes": actual_bytes,
                "maximumBytes": maximum_bytes,
                "recommendation": recommendation,
            },
        )


import io
import asyncio
import re
from typing import Any, Dict, Tuple
import pandas as pd
from fastapi import HTTPException
from app.domain.interfaces.analytics import IAnalyticsStrategy


FORMULA_PREFIX = re.compile(r"^(?:[\s\x00-\x1f])*[=+\-@]|^[\t\r\n]")


def safe_spreadsheet_value(value):
    return "'" + value if isinstance(value, str) and FORMULA_PREFIX.search(value) else value


def safe_spreadsheet_frame(df):
    safe = df.map(safe_spreadsheet_value)
    safe.columns = [safe_spreadsheet_value(value) for value in df.columns]
    return safe


class ExportStrategy(IAnalyticsStrategy):
    @property
    def strategy_name(self) -> str:
        return "export"

    async def execute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Tuple[io.BytesIO, str, str]:
        return await asyncio.to_thread(self._compute, df, params)

    def _compute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Tuple[io.BytesIO, str, str]:
        format_type = params.get("format", "csv").lower()
        buffer = io.BytesIO()

        if format_type == "csv":
            csv_bytes = safe_spreadsheet_frame(df).to_csv(index=False).encode("utf-8")
            buffer.write(csv_bytes)
            buffer.seek(0)
            media_type = "text/csv"
            ext = "csv"
        elif format_type == "xlsx":
            with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
                safe_spreadsheet_frame(df).to_excel(writer, index=False)
            buffer.seek(0)
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ext = "xlsx"
        elif format_type == "json":
            json_bytes = df.to_json(orient="records").encode("utf-8")
            buffer.write(json_bytes)
            buffer.seek(0)
            media_type = "application/json"
            ext = "json"
        elif format_type == "parquet":
            df.to_parquet(buffer, index=False)
            buffer.seek(0)
            media_type = "application/octet-stream"
            ext = "parquet"
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported export format: {format_type}")

        return buffer, media_type, ext

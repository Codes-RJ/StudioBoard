import asyncio
from typing import Any, Dict
import pandas as pd
from fastapi import HTTPException
from app.domain.interfaces.analytics import IAnalyticsStrategy
from app.services.analytics.data_loader import convert_numpy_types


class TimeSeriesStrategy(IAnalyticsStrategy):
    MAX_PERIODS = 5_000
    @property
    def strategy_name(self) -> str:
        return "timeseries"

    async def execute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        return await asyncio.to_thread(self._compute, df, params)

    def _compute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        date_col = params.get("date_col")
        value_col = params.get("value_col")
        freq = params.get("freq", "ME")

        if date_col not in df.columns:
            raise HTTPException(status_code=400, detail=f"Date column '{date_col}' not found")
        if value_col not in df.columns:
            raise HTTPException(status_code=400, detail=f"Value column '{value_col}' not found")

        work_df = df[[date_col, value_col]].dropna().copy()
        work_df[date_col] = pd.to_datetime(work_df[date_col], errors="coerce")
        work_df[value_col] = pd.to_numeric(work_df[value_col], errors="coerce")
        work_df = work_df.dropna()

        if work_df.empty:
            raise HTTPException(status_code=400, detail="No valid date-value rows found for time series analysis")

        work_df.set_index(date_col, inplace=True)
        resampled = work_df[value_col].resample(freq).agg(["mean", "sum", "count"]).fillna(0)
        if len(resampled) > self.MAX_PERIODS:
            raise HTTPException(
                status_code=400,
                detail=f"Time series exceeds the {self.MAX_PERIODS:,}-period limit. Use a coarser frequency or filter the data."
            )

        data = []
        for date_idx, row in resampled.iterrows():
            data.append({
                "date": date_idx.strftime("%Y-%m-%d"),
                "mean": float(row["mean"]),
                "sum": float(row["sum"]),
                "count": int(row["count"])
            })

        trend = "stable"
        if len(data) > 1:
            means = [d["mean"] for d in data if d["count"] > 0]
            if len(means) > 1:
                trend = "increasing" if means[-1] > means[0] else ("decreasing" if means[-1] < means[0] else "stable")

        return {
            "freq": freq,
            "data": data,
            "trend": trend,
            "total_periods": len(data),
            "date_range": {
                "start": data[0]["date"] if data else None,
                "end": data[-1]["date"] if data else None
            }
        }

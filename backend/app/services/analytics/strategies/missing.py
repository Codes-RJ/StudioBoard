import asyncio
from typing import Any, Dict
import pandas as pd
from fastapi import HTTPException
from app.domain.interfaces.analytics import IAnalyticsStrategy
from app.services.analytics.data_loader import convert_numpy_types


class MissingValueStrategy(IAnalyticsStrategy):
    @property
    def strategy_name(self) -> str:
        return "missing"

    async def execute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        return await asyncio.to_thread(self._compute, df, params)

    def _compute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        strategy = params.get("strategy", "mean")
        fill_value = params.get("fill_value")

        missing_before = df.isna().sum().to_dict()

        if strategy == "drop":
            df_cleaned = df.dropna()
        elif strategy == "mean":
            numeric_means = df.mean(numeric_only=True)
            df_cleaned = df.fillna(numeric_means)
        elif strategy == "median":
            numeric_medians = df.median(numeric_only=True)
            df_cleaned = df.fillna(numeric_medians)
        elif strategy == "mode":
            df_cleaned = df.copy()
            for col in df_cleaned.columns:
                col_mode = df_cleaned[col].mode()
                if not col_mode.empty:
                    df_cleaned[col] = df_cleaned[col].fillna(col_mode.iloc[0])
        elif strategy == "fill_value":
            df_cleaned = df.fillna(fill_value)
        else:
            raise HTTPException(status_code=400, detail=f"Invalid missing value strategy: {strategy}")

        missing_after = df_cleaned.isna().sum().to_dict()
        preview = convert_numpy_types(df_cleaned.head(100).to_dict(orient="records"))

        return convert_numpy_types({
            "rows_before": len(df),
            "rows_after": len(df_cleaned),
            "missing_before": {k: int(v) for k, v in missing_before.items() if v > 0},
            "missing_after": {k: int(v) for k, v in missing_after.items() if v > 0},
            "preview": preview
        })

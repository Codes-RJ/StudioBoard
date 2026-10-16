import asyncio
from typing import Any, Dict
import pandas as pd
import numpy as np
from app.domain.interfaces.analytics import IAnalyticsStrategy
from app.services.analytics.data_loader import convert_numpy_types


class DescriptiveStatsStrategy(IAnalyticsStrategy):
    @property
    def strategy_name(self) -> str:
        return "statistics"

    async def execute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        return await asyncio.to_thread(self._compute, df, params)

    def _compute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        columns = params.get("columns")
        if columns:
            valid_cols = [c for c in columns if c in df.columns]
            if valid_cols:
                df = df[valid_cols]

        stats = {}
        numeric_cols = df.select_dtypes(include=[np.number]).columns

        for col in numeric_cols:
            series = df[col].dropna()
            count = int(series.count())
            missing = int(df[col].isna().sum())
            
            if count > 0:
                stats[col] = {
                    "mean": float(series.mean()),
                    "median": float(series.median()),
                    "std": float(series.std()) if count > 1 else 0.0,
                    "variance": float(series.var()) if count > 1 else 0.0,
                    "min": float(series.min()),
                    "max": float(series.max()),
                    "count": count,
                    "missing": missing,
                    "skewness": float(series.skew()) if count > 2 else 0.0,
                    "kurtosis": float(series.kurtosis()) if count > 3 else 0.0
                }
            else:
                stats[col] = {
                    "mean": None, "median": None, "std": None, "variance": None,
                    "min": None, "max": None, "count": 0, "missing": missing,
                    "skewness": None, "kurtosis": None
                }

        # Categorical columns info
        categorical_cols = df.select_dtypes(include=["object", "category", "bool"]).columns
        for col in categorical_cols:
            mode_series = df[col].mode()
            most_common = convert_numpy_types(mode_series.iloc[0]) if not mode_series.empty else None
            stats[col] = {
                "unique_values": int(df[col].nunique()),
                "most_common": most_common,
                "missing": int(df[col].isna().sum())
            }

        return convert_numpy_types(stats)

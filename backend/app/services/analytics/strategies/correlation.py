import asyncio
from typing import Any, Dict
import pandas as pd
import numpy as np
from fastapi import HTTPException
from app.domain.interfaces.analytics import IAnalyticsStrategy
from app.services.analytics.data_loader import convert_numpy_types


class CorrelationStrategy(IAnalyticsStrategy):
    @property
    def strategy_name(self) -> str:
        return "correlation"

    async def execute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        return await asyncio.to_thread(self._compute, df, params)

    def _compute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        method = params.get("method", "pearson")
        columns = params.get("columns")

        numeric_df = df.select_dtypes(include=[np.number])
        if columns:
            valid_cols = [c for c in columns if c in numeric_df.columns]
            if valid_cols:
                numeric_df = numeric_df[valid_cols]

        if numeric_df.shape[1] > 100:
            raise HTTPException(
                status_code=400,
                detail="Correlation is limited to 100 numeric columns per request"
            )

        if numeric_df.empty or numeric_df.shape[1] < 2:
            return {}

        corr_matrix = numeric_df.corr(method=method)
        result = {}
        for col1 in corr_matrix.columns:
            result[col1] = {}
            for col2 in corr_matrix.index:
                val = corr_matrix.loc[col2, col1]
                result[col1][col2] = float(val) if pd.notna(val) else None

        return convert_numpy_types(result)

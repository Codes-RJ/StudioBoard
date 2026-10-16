import asyncio
from typing import Any, Dict
import pandas as pd
import numpy as np
from scipy import stats
from fastapi import HTTPException
from app.domain.interfaces.analytics import IAnalyticsStrategy
from app.services.analytics.data_loader import convert_numpy_types


class OutlierDetectionStrategy(IAnalyticsStrategy):
    @property
    def strategy_name(self) -> str:
        return "outliers"

    async def execute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        return await asyncio.to_thread(self._compute, df, params)

    def _compute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        column = params.get("column")
        method = params.get("method", "iqr")
        threshold = float(params.get("threshold", 3.0))

        if not column or column not in df.columns:
            raise HTTPException(status_code=400, detail=f"Column '{column}' not found")

        data = pd.to_numeric(df[column], errors="coerce").dropna()
        if data.empty:
            raise HTTPException(status_code=400, detail=f"Column '{column}' has no valid numeric data")

        outliers = []
        outlier_indices = []

        if method == "zscore":
            z_scores = np.abs(stats.zscore(data))
            matches = data.iloc[np.flatnonzero(z_scores > threshold)]
            outlier_indices = matches.index.tolist()
            outliers = matches.tolist()
        elif method == "iqr":
            q1 = data.quantile(0.25)
            q3 = data.quantile(0.75)
            iqr = q3 - q1
            lower_bound = q1 - 1.5 * iqr
            upper_bound = q3 + 1.5 * iqr
            matches = data[(data < lower_bound) | (data > upper_bound)]
            outlier_indices = matches.index.tolist()
            outliers = matches.tolist()
        else:
            raise HTTPException(status_code=400, detail=f"Invalid outlier method: {method}")

        return {
            "column": column,
            "method": method,
            "threshold": threshold,
            "total_rows": len(data),
            "outliers_count": len(outliers),
            "outliers": outliers[:100],
            # Source DataFrame index labels, never positions in the reduced
            # non-null series. File loaders use zero-based source row labels.
            "outlier_indices": [int(i) for i in outlier_indices[:100]],
            "stats": {
                "mean": float(data.mean()),
                "std": float(data.std()) if len(data) > 1 else 0.0,
                "min": float(data.min()),
                "max": float(data.max()),
                "q1": float(data.quantile(0.25)),
                "q3": float(data.quantile(0.75))
            }
        }

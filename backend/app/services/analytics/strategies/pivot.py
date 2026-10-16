import asyncio
from typing import Any, Dict
import pandas as pd
from fastapi import HTTPException
from app.domain.interfaces.analytics import IAnalyticsStrategy
from app.services.analytics.data_loader import convert_numpy_types


class PivotTableStrategy(IAnalyticsStrategy):
    MAX_PIVOT_CELLS = 10_000
    @property
    def strategy_name(self) -> str:
        return "pivot"

    async def execute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        return await asyncio.to_thread(self._compute, df, params)

    def _compute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        index_col = params.get("index")
        columns_col = params.get("columns")
        values_col = params.get("values")
        aggfunc = params.get("aggfunc", "mean")

        for col_name in [index_col, columns_col, values_col]:
            if col_name and col_name not in df.columns:
                raise HTTPException(status_code=400, detail=f"Column '{col_name}' not found")

        index_cardinality = int(df[index_col].nunique(dropna=False))
        columns_cardinality = int(df[columns_col].nunique(dropna=False)) if columns_col else 1
        if index_cardinality * columns_cardinality > self.MAX_PIVOT_CELLS:
            raise HTTPException(
                status_code=400,
                detail=f"Pivot result exceeds the {self.MAX_PIVOT_CELLS:,}-cell limit. Filter the dataset or use lower-cardinality dimensions."
            )

        pivot_table = pd.pivot_table(
            df,
            values=values_col,
            index=index_col,
            columns=columns_col,
            aggfunc=aggfunc,
            fill_value=0
        )

        result = {
            "index": list(pivot_table.index),
            "columns": list(pivot_table.columns),
            "data": pivot_table.to_dict(),
            "shape": pivot_table.shape
        }

        return convert_numpy_types(result)

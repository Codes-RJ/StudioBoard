from typing import Dict, Any, List, Optional
import asyncio
import pandas as pd
from fastapi import HTTPException
from anyio import CapacityLimiter

from app.core.config import settings
from app.domain.interfaces.analytics import IAnalyticsStrategy
from app.services.analytics.data_loader import load_dataframe, convert_numpy_types
from app.services.analytics.strategies.statistics import DescriptiveStatsStrategy
from app.services.analytics.strategies.correlation import CorrelationStrategy
from app.services.analytics.strategies.regression import LinearRegressionStrategy
from app.services.analytics.strategies.pivot import PivotTableStrategy
from app.services.analytics.strategies.timeseries import TimeSeriesStrategy
from app.services.analytics.strategies.outliers import OutlierDetectionStrategy
from app.services.analytics.strategies.missing import MissingValueStrategy
from app.services.analytics.strategies.export import ExportStrategy


class AnalyticsEngine:
    """
    OOP Analytics Engine that coordinates data loading, caching,
    data slicing, and strategy execution.
    """

    def __init__(self):
        self._strategies: Dict[str, IAnalyticsStrategy] = {}
        self._work_limiter = CapacityLimiter(settings.ANALYTICS_MAX_CONCURRENT_REQUESTS)
        self._register_default_strategies()

    def _register_default_strategies(self) -> None:
        defaults = [
            DescriptiveStatsStrategy(),
            CorrelationStrategy(),
            LinearRegressionStrategy(),
            PivotTableStrategy(),
            TimeSeriesStrategy(),
            OutlierDetectionStrategy(),
            MissingValueStrategy(),
            ExportStrategy()
        ]
        for strategy in defaults:
            self.register_strategy(strategy)

    def register_strategy(self, strategy: IAnalyticsStrategy) -> None:
        self._strategies[strategy.strategy_name] = strategy

    def get_strategy(self, name: str) -> IAnalyticsStrategy:
        strategy = self._strategies.get(name)
        if not strategy:
            raise HTTPException(status_code=400, detail=f"Analytics strategy '{name}' is not registered.")
        return strategy

    async def execute_strategy(self, strategy_name: str, file_path: str, params: Dict[str, Any]) -> Any:
        async with self._work_limiter:
            strategy = self.get_strategy(strategy_name)
            df = await asyncio.to_thread(load_dataframe, file_path)
            return await strategy.execute(df, params)

    async def execute_blocking_task(self, function, *args) -> Any:
        """Run non-strategy DataFrame work under the same capacity budget."""
        async with self._work_limiter:
            return await asyncio.to_thread(function, *args)

    async def get_paginated_data(
        self,
        file_path: str,
        page: int = 1,
        limit: int = 50,
        sort: Optional[str] = None,
        order: Optional[str] = "asc",
        filters: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        async with self._work_limiter:
            return await asyncio.to_thread(
                self._get_paginated_data,
                file_path,
                page,
                limit,
                sort,
                order,
                filters,
            )

    def _get_paginated_data(
        self,
        file_path: str,
        page: int = 1,
        limit: int = 50,
        sort: Optional[str] = None,
        order: Optional[str] = "asc",
        filters: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        df = load_dataframe(file_path)

        # Apply column filters
        if filters and isinstance(filters, dict):
            for col, val in filters.items():
                if col in df.columns and val is not None and str(val).strip() != "":
                    if df[col].dtype == "object":
                        df = df[df[col].astype(str).str.contains(str(val), case=False, na=False, regex=False)]
                    else:
                        num_val = pd.to_numeric(val, errors="coerce")
                        if pd.notna(num_val):
                            df = df[df[col] == num_val]
                        else:
                            df = df[df[col].astype(str).str.contains(str(val), case=False, na=False, regex=False)]

        # Apply sorting
        if sort and sort in df.columns:
            ascending = (order or "asc").lower() == "asc"
            df = df.sort_values(by=sort, ascending=ascending)

        total = len(df)
        if limit <= 0:
            start = 0
            end = total
        else:
            start = (page - 1) * limit
            end = start + limit

        page_records = convert_numpy_types(df.iloc[start:end].to_dict(orient="records"))
        columns_list = convert_numpy_types(list(df.columns))

        return {
            "data": page_records,
            "total": total,
            "page": page,
            "limit": limit if limit > 0 else total,
            "columns": columns_list
        }


analytics_engine = AnalyticsEngine()

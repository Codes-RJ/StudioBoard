import asyncio
from typing import Any, Dict
import pandas as pd
import numpy as np
from fastapi import HTTPException
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score, mean_squared_error
from app.domain.interfaces.analytics import IAnalyticsStrategy
from app.services.analytics.data_loader import convert_numpy_types


class LinearRegressionStrategy(IAnalyticsStrategy):
    @property
    def strategy_name(self) -> str:
        return "regression"

    async def execute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        return await asyncio.to_thread(self._compute, df, params)

    def _compute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        x_col = params.get("x")
        y_col = params.get("y")

        if not x_col or not y_col:
            raise HTTPException(status_code=400, detail="Parameters 'x' and 'y' columns are required")
        if x_col == y_col:
            raise HTTPException(status_code=400, detail="Regression requires different columns for x and y")

        if x_col not in df.columns:
            raise HTTPException(status_code=400, detail=f"Column '{x_col}' not found")
        if y_col not in df.columns:
            raise HTTPException(status_code=400, detail=f"Column '{y_col}' not found")

        data = df[[x_col, y_col]].dropna()
        # Ensure both are numeric
        data[x_col] = pd.to_numeric(data[x_col], errors="coerce")
        data[y_col] = pd.to_numeric(data[y_col], errors="coerce")
        data = data.dropna()

        if len(data) < 2:
            raise HTTPException(status_code=400, detail="Insufficient non-null numeric data points for regression")

        X = data[x_col].values.reshape(-1, 1)
        y = data[y_col].values

        model = LinearRegression()
        model.fit(X, y)

        y_pred = model.predict(X)
        r2 = float(r2_score(y, y_pred)) if len(y) > 1 else 0.0
        mse = float(mean_squared_error(y, y_pred))
        rmse = float(np.sqrt(mse))

        predictions = [
            {"x": float(x_val), "actual": float(act), "predicted": float(pred)}
            for x_val, act, pred in zip(data[x_col], y, y_pred)
        ][:100]

        coef = float(model.coef_[0])
        intercept = float(model.intercept_)

        return {
            "coefficient": coef,
            "intercept": intercept,
            "r2_score": r2,
            "mse": mse,
            "rmse": rmse,
            "n_observations": len(data),
            "equation": f"{y_col} = {coef:.4f} * {x_col} + {intercept:.4f}",
            "predictions": predictions
        }

import json
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


def safe_json_loads(value: Any, fallback: Any = None) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return fallback


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=256)


class UserResponse(BaseModel):
    id: str
    email: str
    name: Optional[str] = None
    role: str = "USER"
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None

    class Config:
        from_attributes = True


class DatasetResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    fileName: str
    fileSize: int = 0
    mimeType: Optional[str] = None
    checksum: Optional[str] = None
    rowCount: int
    columns: List[Any]
    createdAt: datetime
    updatedAt: datetime
    userId: str
    user: Optional[UserResponse] = None

    @field_validator("columns", mode="before")
    @classmethod
    def parse_columns_json(cls, value: Any) -> List[Any]:
        return safe_json_loads(value, [])

    class Config:
        from_attributes = True


class DatasetListResponse(BaseModel):
    datasets: List[DatasetResponse]
    pagination: Dict[str, Any]


class DashboardLayoutCreate(BaseModel):
    name: str
    layout: List[Dict[str, Any]]


class DashboardLayoutUpdate(BaseModel):
    name: Optional[str] = None
    layout: Optional[List[Dict[str, Any]]] = None
    version: int = Field(ge=1)


class DashboardLayoutResponse(BaseModel):
    id: str
    name: str
    layout: List[Dict[str, Any]]
    version: int
    createdAt: datetime
    updatedAt: datetime
    userId: str

    @field_validator("layout", mode="before")
    @classmethod
    def parse_layout_json(cls, value: Any) -> List[Dict[str, Any]]:
        return safe_json_loads(value, [])

    class Config:
        from_attributes = True


class ExportRequest(BaseModel):
    format: Literal["csv", "xlsx", "json", "parquet"] = "csv"


class AnalyticsDatasetRequest(BaseModel):
    """Base contract shared by all server-side analytics requests."""

    model_config = ConfigDict(extra="forbid")

    datasetId: str = Field(min_length=1, max_length=191)


class AnalyticsColumnsRequest(AnalyticsDatasetRequest):
    columns: Optional[List[str]] = Field(default=None, min_length=1, max_length=100)

    @field_validator("columns")
    @classmethod
    def validate_columns(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return value
        if any(not column.strip() or len(column) > 191 for column in value):
            raise ValueError("columns must contain non-empty names of at most 191 characters")
        if len(set(value)) != len(value):
            raise ValueError("columns must not contain duplicates")
        return value


class CorrelationRequest(AnalyticsColumnsRequest):
    method: Literal["pearson", "spearman", "kendall"] = "pearson"


class RegressionRequest(AnalyticsDatasetRequest):
    x: str = Field(min_length=1, max_length=191)
    y: str = Field(min_length=1, max_length=191)

    @model_validator(mode="after")
    def validate_distinct_columns(self):
        if self.x == self.y:
            raise ValueError("Regression requires different columns for x and y")
        return self


class PivotRequest(AnalyticsDatasetRequest):
    index: str = Field(min_length=1, max_length=191)
    columns: Optional[str] = Field(default=None, min_length=1, max_length=191)
    values: str = Field(min_length=1, max_length=191)
    aggfunc: Literal["mean", "sum", "count", "min", "max", "median"] = "mean"


class TimeSeriesRequest(AnalyticsDatasetRequest):
    date_col: str = Field(min_length=1, max_length=191)
    value_col: str = Field(min_length=1, max_length=191)
    freq: Literal["D", "W", "ME", "QE", "YE"] = "ME"


class OutlierRequest(AnalyticsDatasetRequest):
    column: str = Field(min_length=1, max_length=191)
    method: Literal["zscore", "iqr"] = "iqr"
    threshold: float = Field(default=3.0, gt=0, le=10)


class MissingValuesRequest(AnalyticsDatasetRequest):
    strategy: Literal["drop", "mean", "median", "mode", "fill_value"] = "mean"
    fill_value: Optional[str | int | float | bool] = None


AnalyticsJobStrategy = Literal["statistics", "correlation", "regression", "pivot", "timeseries", "outliers", "missing"]


class AnalyticsJobCreate(AnalyticsDatasetRequest):
    """Asynchronous form of an analytics request. Parameters are validated per strategy."""

    strategy: AnalyticsJobStrategy
    parameters: Dict[str, Any] = Field(default_factory=dict)


class ExportJobCreate(AnalyticsDatasetRequest):
    format: Literal["csv", "xlsx", "json", "parquet"] = "csv"


class AnalyticsJobResponse(BaseModel):
    id: str
    kind: str
    strategy: str
    status: str
    result: Optional[Any] = None
    error: Optional[str] = None
    outputMimeType: Optional[str] = None
    attempts: int
    createdAt: datetime
    updatedAt: datetime
    startedAt: Optional[datetime] = None
    completedAt: Optional[datetime] = None

    class Config:
        from_attributes = True

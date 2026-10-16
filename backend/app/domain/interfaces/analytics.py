from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
import pandas as pd


class IAnalyticsStrategy(ABC):
    """
    Abstract Strategy pattern interface for all analytics computations.
    Enables plug-and-play statistical algorithms with full type safety.
    """

    @property
    @abstractmethod
    def strategy_name(self) -> str:
        """Unique identifier of the strategy (e.g., 'descriptive_stats', 'correlation')."""
        pass

    @abstractmethod
    async def execute(self, df: pd.DataFrame, params: Dict[str, Any]) -> Any:
        """Executes the specific computation on the provided DataFrame."""
        pass

"""Conservative suggestions from declared fields, not statistical findings."""
import re
from typing import Any, Dict


def _words(field: str) -> str:
    return re.sub(r"([a-z])([A-Z])", r"\1 \2", field).replace("_", " ").replace("-", " ").lower()


def _identifier(field: str) -> bool:
    return bool(re.search(r"\b(id|identifier|key|uuid|guid)\b", _words(field)))


def _aggregation(field: str) -> str:
    words = _words(field)
    if re.search(r"\b(rate|ratio|percent|percentage|margin|price|average|avg|mean|age|duration|latency|temperature|balance|inventory|stock|mrr|arr|cac|score)\b|%", words):
        return "average"
    return "sum" if re.search(r"\b(revenue|sales|amount|total|quantity|units|volume|cost|expense|spend|profit|loss)\b", words) else "average"


class DashboardLayoutPlanner:
    def plan_layout(self, dataset_id: str, snapshot: Dict[str, Any]) -> Dict[str, Any]:
        columns = snapshot.get("columns", {})
        known = set(columns.get("all", []))
        measures = [field for field in columns.get("measureColumns", []) if field in known and not _identifier(field)]
        dates = [field for field in columns.get("dateColumns", []) if field in known]
        dimensions = [field for field in columns.get("dimensions", []) if field in known and field not in dates and not _identifier(field)]
        items = []

        def add(title, chart_type, x="", y="", aggregation="auto"):
            index = len(items)
            items.append({"i": str(index + 1), "x": index % 2 * 6, "y": index // 2 * 4,
                          "w": 6, "h": 4, "title": title, "chartType": chart_type,
                          "preferredX": x, "preferredY": y, "aggregation": aggregation, "topN": 12})

        if measures:
            measure = measures[0]
            aggregation = _aggregation(measure)
            label = f"{'Total' if aggregation == 'sum' else 'Average'} {measure}"
            add(label, "kpi", y=measure, aggregation=aggregation)
            if dimensions:
                add(f"{label} by {dimensions[0]}", "bar", dimensions[0], measure, aggregation)
            if dates:
                add(f"{label} over {dates[0]}", "line", dates[0], measure, aggregation)
            if len(items) < 3:
                add(f"{measure} distribution", "histogram", measure)
        elif dimensions:
            add(f"Rows by {dimensions[0]}", "bar", dimensions[0], "__count__", "count")
        add("Source rows", "table")
        return {"id": f"plan-{dataset_id}", "name": f"Smart Layout ({snapshot.get('dataset', {}).get('name', 'Dataset')})",
                "layout": items, "source": "planner", "sourceDatasetId": dataset_id,
                "createdAt": snapshot.get("meta", {}).get("generatedAt"), "updatedAt": snapshot.get("meta", {}).get("generatedAt")}


layout_planner = DashboardLayoutPlanner()

from app.services.layout_planner import DashboardLayoutPlanner


def test_rate_layout_is_explicit_and_does_not_invent_flows_or_quality():
    snapshot = {"columns": {"all": ["Region", "ConversionRate"], "measureColumns": ["ConversionRate"], "dimensions": ["Region"], "dateColumns": []}}
    cards = DashboardLayoutPlanner().plan_layout("rates", snapshot)["layout"]
    assert any(card.get("preferredX") == "Region" and card.get("aggregation") == "average" for card in cards)
    assert all(card["chartType"] not in {"sankey", "treemap", "gauge", "heatmap", "line", "area"} for card in cards)
    assert all("Health" not in card["title"] for card in cards)


def test_empty_and_identifier_only_sources_have_an_honest_table_fallback():
    planner = DashboardLayoutPlanner()
    for columns in [{}, {"all": ["CustomerID"], "measureColumns": ["CustomerID"]}]:
        cards = planner.plan_layout("empty", {"columns": columns})["layout"]
        assert [card["chartType"] for card in cards] == ["table"]


def test_trend_requires_a_declared_date_and_measure_and_keeps_plan_identity():
    snapshot = {"dataset": {"name": "Sales"}, "meta": {"generatedAt": "fixture-time"}, "columns": {
        "all": ["Date", "Revenue"], "measureColumns": ["Revenue"], "dimensions": ["Date"], "dateColumns": ["Date"]}}
    plan = DashboardLayoutPlanner().plan_layout("sales", snapshot)
    assert plan["sourceDatasetId"] == "sales"
    assert plan["createdAt"] == "fixture-time"
    trend = next(card for card in plan["layout"] if card["chartType"] == "line")
    assert trend["preferredX"] == "Date"
    assert trend["preferredY"] == "Revenue"
    assert trend["aggregation"] == "sum"

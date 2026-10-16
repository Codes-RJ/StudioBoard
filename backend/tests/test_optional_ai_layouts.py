import json

import pytest

from app.api.v1 import ai


def test_unprovided_profile_stats_do_not_imply_zero_missing_values():
    payload = ai.DashboardPlanRequest(goal="overview", rowCount=10, columns=[
        ai.ProfileColumn(name="Region", type="string", role="dimension"),
    ])
    assert "missingPercent" not in payload.model_dump(exclude_none=True)["columns"][0]


@pytest.mark.asyncio
async def test_optional_ai_status_is_unavailable_by_default(client, monkeypatch):
    monkeypatch.setattr(ai.settings, "AI_LAYOUT_ENABLED", True)
    monkeypatch.setattr(ai.settings, "OPENAI_API_KEY", "test-key")
    response = await client.get("/api/ai/status")
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_opted_in_layout_request_sends_only_profile_metadata(client, monkeypatch):
    monkeypatch.setattr(ai.settings, "AI_LAYOUT_ENABLED", True)
    monkeypatch.setattr(ai.settings, "OPENAI_API_KEY", "test-key")
    captured = {}

    def fake_provider(payload):
        captured.update(payload)
        return {"output_text": json.dumps({
            "title": "Revenue overview",
            "summary": "Compare revenue by region.",
            "cards": [{"title": "Revenue by region", "chartType": "bar", "xField": "Region", "yField": "Revenue", "aggregation": "sum"}],
        })}

    monkeypatch.setattr(ai, "_post_openai", fake_provider)
    settings_update = await client.put("/api/admin/config", json={"features": {"aiLayoutSuggestions": "authenticated"}})
    assert settings_update.status_code == 200
    assert (await client.get("/api/ai/status")).json() == {"available": True}
    payload = {
        "goal": "comparisons",
        "purpose": "Review sales performance",
        "rowCount": 500,
        "columns": [
            {"name": "Region", "type": "string", "role": "dimension", "missingPercent": 2, "distinctCount": 8},
            {"name": "Revenue", "type": "number", "role": "measure", "missingPercent": 0, "distinctCount": 320},
        ],
    }
    response = await client.post("/api/ai/dashboard-plan", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["cards"][0]["yField"] == "Revenue"
    assert captured["store"] is False
    assert "Revenue" in captured["input"][1]["content"]
    assert "values" not in captured["input"][1]["content"].lower()
    assert captured["text"]["format"]["type"] == "json_schema"


@pytest.mark.asyncio
async def test_provider_output_must_reference_shared_fields(client, monkeypatch):
    monkeypatch.setattr(ai.settings, "AI_LAYOUT_ENABLED", True)
    monkeypatch.setattr(ai.settings, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(ai, "_post_openai", lambda _payload: {"output_text": json.dumps({
        "title": "Invalid", "summary": "Uses a fabricated field.",
        "cards": [{"title": "Fabricated", "chartType": "bar", "xField": "Invented", "yField": "Revenue", "aggregation": "sum"}],
    })})
    await client.put("/api/admin/config", json={"features": {"aiLayoutSuggestions": "authenticated"}})
    response = await client.post("/api/ai/dashboard-plan", json={
        "goal": "comparisons", "rowCount": 5,
        "columns": [{"name": "Revenue", "type": "number", "role": "measure"}],
    })
    assert response.status_code == 502


@pytest.mark.asyncio
async def test_ai_input_schema_rejects_row_values(client, monkeypatch):
    monkeypatch.setattr(ai.settings, "AI_LAYOUT_ENABLED", True)
    monkeypatch.setattr(ai.settings, "OPENAI_API_KEY", "test-key")
    await client.put("/api/admin/config", json={"features": {"aiLayoutSuggestions": "authenticated"}})
    response = await client.post("/api/ai/dashboard-plan", json={
        "goal": "overview", "rowCount": 1,
        "columns": [{"name": "Revenue", "type": "number", "values": [10, 20]}],
    })
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("x_field,y_field,aggregation,expected_status", [
    ("Region", "__count__", "count", 200),
    ("Region", "__count__", "average", 502),
    ("__count__", "__count__", "count", 502),
    ("Customer ID", "__count__", "count", 502),
])
async def test_row_count_proposals_respect_reserved_fields_and_roles(client, monkeypatch, x_field, y_field, aggregation, expected_status):
    monkeypatch.setattr(ai.settings, "AI_LAYOUT_ENABLED", True)
    monkeypatch.setattr(ai.settings, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(ai, "_post_openai", lambda _payload: {"output_text": json.dumps({
        "title": "Row counts", "summary": "Count records by region.",
        "cards": [{"title": "Records", "chartType": "bar", "xField": x_field, "yField": y_field, "aggregation": aggregation}],
    })})
    await client.put("/api/admin/config", json={"features": {"aiLayoutSuggestions": "authenticated"}})
    response = await client.post("/api/ai/dashboard-plan", json={
        "goal": "overview", "rowCount": 10,
        "columns": [{"name": "Region", "type": "string", "role": "dimension"}, {"name": "Customer ID", "type": "string", "role": "identifier"}],
    })
    assert response.status_code == expected_status

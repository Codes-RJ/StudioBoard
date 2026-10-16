import pytest


@pytest.mark.asyncio
async def test_layout_updates_reject_stale_versions(client):
    created = await client.post(
        "/api/layouts",
        json={"name": "Operations", "layout": [{"i": "chart-1", "x": 0, "y": 0, "w": 4, "h": 4}]},
    )
    assert created.status_code == 201
    original = created.json()
    assert original["version"] == 1

    updated = await client.put(
        f"/api/layouts/{original['id']}",
        json={"name": "Operations v2", "layout": original["layout"], "version": 1},
    )
    assert updated.status_code == 200
    assert updated.json()["version"] == 2

    stale = await client.put(
        f"/api/layouts/{original['id']}",
        json={"name": "Stale overwrite", "layout": original["layout"], "version": 1},
    )
    assert stale.status_code == 409
    assert "another session" in stale.json()["detail"]

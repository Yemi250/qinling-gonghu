"""Verify that beautiful memories persist separately and remain credential protected."""

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.tests.test_api import upload, visitor_login


def test_postcard_is_private_persistent_and_not_a_work_order(client, settings):
    """Scenic uploads must never populate environmental queues or counters."""
    picture = upload(client, "blue")
    response = client.post(
        "/api/postcards",
        json={
            "scenic_id": "qinling-demo",
            "description": "山间的云",
            "images": [picture],
        },
    )
    assert response.status_code == 201
    created = response.json()
    path = f"/api/postcards/{created['postcard']['id']}"
    assert client.get(path, headers={"Cookie": ""}).status_code == 401
    assert client.get(path, headers={"X-Visitor-Token": "wrong"}).status_code == 403
    assert client.get("/api/overview").json()["total"] == 0
    headers = {"X-Visitor-Token": created["query_token"]}
    with TestClient(create_app(settings)) as restarted:
        visitor_login(restarted)
        saved = restarted.get(path, headers=headers)
        assert saved.status_code == 200
        assert saved.json()["description"] == "山间的云"
        assert "query_token" not in saved.json()
        assert restarted.get(saved.json()["images"][0]["url"]).status_code == 200
    duplicate = client.post(
        "/api/events",
        json={
            "scenic_id": "qinling-demo",
            "point_id": "trail-entrance",
            "original_images": [picture],
        },
    )
    assert duplicate.status_code == 409


def test_terracotta_care_uses_its_own_valid_point(client):
    """The second scene cannot accidentally create events at the Qinling point."""
    picture = upload(client)
    invalid = client.post(
        "/api/events",
        json={
            "scenic_id": "terracotta-demo",
            "point_id": "trail-entrance",
            "original_images": [picture],
        },
    )
    assert invalid.status_code == 422
    valid = client.post(
        "/api/events",
        json={
            "scenic_id": "terracotta-demo",
            "point_id": "terracotta-entry",
            "original_images": [picture],
            "is_demo": True,
        },
    )
    assert valid.status_code == 201


@pytest.mark.parametrize("slug", ["huashan", "baotashan", "hanzhong", "zhenbeitai"])
def test_new_scenic_chapters_keep_memories_private_and_points_scoped(client, settings, slug):
    """All new chapters save both kinds of uploads without crossing scenic boundaries."""
    scenic_id = f"{slug}-demo"
    points = [
        p for p in client.get("/api/overview").json()["points"] if p["scenic_id"] == scenic_id
    ]
    assert {p["id"] for p in points} == {f"{slug}-entry", f"{slug}-rest"}
    postcard = client.post(
        "/api/postcards",
        json={
            "scenic_id": scenic_id,
            "description": slug,
            "images": [upload(client, "blue")],
        },
    )
    assert postcard.status_code == 201
    memory = postcard.json()
    memory_path = f"/api/postcards/{memory['postcard']['id']}"
    assert client.get(memory_path, headers={"Cookie": ""}).status_code == 401
    assert client.get("/api/overview").json()["total"] == 0
    image = upload(client, "red")
    body = {"scenic_id": scenic_id, "point_id": "trail-entrance", "original_images": [image]}
    assert client.post("/api/events", json=body).status_code == 422
    body["point_id"] = f"{slug}-rest"
    created = client.post("/api/events", json=body)
    assert created.status_code == 201
    event = created.json()
    event_path = f"/api/events/{event['event']['id']}"
    assert client.get(event_path, headers={"Cookie": ""}).status_code == 401
    with TestClient(create_app(settings)) as restarted:
        visitor_login(restarted)
        saved_memory = restarted.get(
            memory_path, headers={"X-Visitor-Token": memory["query_token"]}
        )
        saved_event = restarted.get(event_path, headers={"X-Visitor-Token": event["query_token"]})
        assert saved_memory.json()["scenic_id"] == scenic_id
        assert saved_event.json()["point_id"] == f"{slug}-rest"


def test_unknown_scenic_memory_is_rejected(client):
    """Extending allowed chapters must not remove scenic validation."""
    assert (
        client.post(
            "/api/postcards",
            json={
                "scenic_id": "unknown-demo",
                "images": [upload(client)],
            },
        ).status_code
        == 422
    )

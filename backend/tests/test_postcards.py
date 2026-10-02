"""Verify that beautiful memories persist separately and remain credential protected."""

from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.tests.test_api import upload


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
    assert client.get(path).status_code == 401
    assert client.get(path, headers={"X-Visitor-Token": "wrong"}).status_code == 403
    assert client.get("/api/overview").json()["total"] == 0
    headers = {"X-Visitor-Token": created["query_token"]}
    with TestClient(create_app(settings)) as restarted:
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

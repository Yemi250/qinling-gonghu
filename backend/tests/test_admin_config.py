"""Verify explicit demo account configuration without embedding user credentials."""

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app


@pytest.mark.parametrize("minimum,status", [(12, 503), (9, 200)])
def test_short_demo_password_requires_explicit_configuration(settings, minimum, status):
    """Default policy stays at twelve; an explicit local nine-character policy enables login."""
    configured = settings.model_copy(
        update={
            "demo_admin_username": "demo-user",
            "demo_admin_password": "demo-pass",
            "demo_admin_min_password_length": minimum,
        }
    )
    with TestClient(create_app(configured)) as client:
        response = client.post(
            "/api/auth/login",
            json={
                "username": "demo-user",
                "password": "demo-pass",
            },
        )
        assert response.status_code == status
        if status == 200:
            headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
            assert client.get("/api/events", headers=headers).status_code == 200
            wrong = client.post(
                "/api/auth/login",
                json={
                    "username": "demo-user",
                    "password": "wrong-pass",
                },
            )
            assert wrong.status_code == 401
            assert client.post("/api/auth/logout", headers=headers).status_code == 204
            assert client.get("/api/events", headers=headers).status_code == 401

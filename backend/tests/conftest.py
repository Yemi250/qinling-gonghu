import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


@pytest.fixture
def settings(tmp_path):
    return Settings(data_dir=tmp_path, demo_admin_password="test-password-for-demo", _env_file=None)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        register = client.post(
            "/api/visitor/register",
            json={
                "username": "fixture_visitor",
                "password": "fixture-visitor-only",
                "confirm_password": "fixture-visitor-only",
                "nickname": "测试游客",
            },
        )
        assert register.status_code == 201, register.text
        client.headers["X-Gonghu-CSRF"] = register.json()["csrf_token"]
        yield client

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
        yield client

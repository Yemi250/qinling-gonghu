"""Real HTTP lifecycle and process-restart check; uses isolated synthetic demo data."""

import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path

import httpx
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def server(data_dir, port, password):
    """Start an isolated server and stop only its own process after HTTP verification."""
    env = {
        **os.environ,
        "DATA_DIR": str(data_dir),
        "DEMO_ADMIN_USERNAME": "admin",
        "DEMO_ADMIN_PASSWORD": password,
        "AI_API_KEY": "",
        "AI_TIMEOUT_SECONDS": "2",
    }
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--workers",
            "1",
            "--no-access-log",
        ],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    try:
        with httpx.Client(
            base_url=f"http://127.0.0.1:{port}", timeout=10, trust_env=False
        ) as client:
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError("Smoke server exited during startup")
                try:
                    if client.get("/api/health").status_code == 200:
                        break
                except httpx.ConnectError:
                    pass
                time.sleep(0.1)
            else:
                raise RuntimeError("Smoke server did not become ready")
            yield client
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def main():
    """Verify upload, permissions and restart while preserving isolated test artifacts."""
    if not (ROOT / "frontend" / "dist" / "index.html").is_file():
        raise RuntimeError("Run npm --prefix frontend run build first")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    password = secrets.token_urlsafe(24)
    data_dir = Path(tempfile.mkdtemp(prefix="gonghu-http-smoke-")).resolve()
    with server(data_dir, port, password) as client:
        assert client.get("/api/health").json()["frontend_built"]
        assert '<div id="root"></div>' in client.get("/").text
        assert '<div id="root"></div>' in client.get("/visitor/example").text
        assert client.get("/api/no-such-route").status_code == 404
        visitor_login = client.post(
            "/api/visitor/register",
            json={
                "username": "http_visitor",
                "password": password,
                "confirm_password": password,
                "nickname": "HTTP测试游客",
            },
        )
        visitor_login.raise_for_status()
        client.headers["X-Gonghu-CSRF"] = visitor_login.json()["csrf_token"]
        image = BytesIO()
        Image.new("RGB", (16, 16), "green").save(image, "PNG")

        def upload():
            """Upload a clearly synthetic image through the actual HTTP endpoint."""
            response = client.post(
                "/api/uploads",
                files={"file": ("synthetic-demo.png", image.getvalue(), "image/png")},
            )
            response.raise_for_status()
            return response.json()

        created = client.post(
            "/api/events",
            json={
                "scenic_id": "qinling-demo",
                "point_id": "trail-entrance",
                "description": "HTTP 自动验收的合成演示材料",
                "original_images": [upload()],
                "is_demo": True,
            },
        )
        created.raise_for_status()
        event = created.json()["event"]
        path = f"/api/events/{event['id']}"
        visitor = {"X-Visitor-Token": created.json()["query_token"]}
        failed = client.post(path + "/analysis", headers=visitor, json={"kind": "report"})
        assert failed.status_code in {200, 502, 503, 504}
        assert client.get(path, headers=visitor).status_code == 200
        login = client.post("/api/auth/login", json={"username": "admin", "password": password})
        login.raise_for_status()
        manager = {"Authorization": f"Bearer {login.json()['access_token']}"}
        assert (
            client.post(
                path + "/actions",
                headers=visitor,
                json={"action": "assign", "assignee": "越权测试"},
            ).status_code
            == 401
        )
        current = client.get(path, headers=visitor).json()
        if current["status"] == "needs_info":
            client.post(
                path + "/actions",
                headers=visitor,
                json={"action": "supplement", "description": "合成图片，仅用于接口验收"},
            ).raise_for_status()
        for action in [
            {"action": "assign", "assignee": "演示清理组"},
            {
                "action": "submit_resolution",
                "note": "演示整改",
                "resolution_images": [upload()],
            },
            {"action": "close", "note": "人工验收通过（合成演示）"},
        ]:
            client.post(path + "/actions", headers=manager, json=action).raise_for_status()
        assert client.get("/api/overview").json()["closed_count"] == 1

    with server(data_dir, port, password) as client:
        login = client.post(
            "/api/visitor/login", json={"username": "http_visitor", "password": password}
        )
        login.raise_for_status()
        saved = client.get(path, headers=visitor).json()
        assert saved["status"] == "closed"
        for picture in saved["original_images"] + saved["resolution_images"]:
            assert client.get(picture["url"]).headers["content-type"] == "image/jpeg"
        assert client.get("/api/overview").json()["total"] == 1
    print(f"Evidence retained: {data_dir}")
    print(
        "PASS: real HTTP upload, permissions, lifecycle, SPA, process restart and image persistence"
    )


if __name__ == "__main__":
    main()

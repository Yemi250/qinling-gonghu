"""Explicit real-model smoke test over HTTP; preserve isolated data and sanitized evidence."""

import hashlib
import json
import os
import secrets
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

import httpx
import uvicorn

from backend.app.config import ROOT, Settings
from backend.app.main import create_app


def run() -> None:
    """Upload two visibly different fixtures, persist real analyses and verify browser output."""
    settings = Settings()
    if not settings.ai_api_key:
        raise SystemExit("AI_API_KEY is not configured; no real-call success claimed.")
    data = Path(tempfile.mkdtemp(prefix="gonghu-live-ai-"))
    password = secrets.token_urlsafe(32)
    isolated = settings.model_copy(update={"data_dir": data, "demo_admin_password": password})
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(isolated),
            host="127.0.0.1",
            port=port,
            access_log=False,
            log_level="error",
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    evidence = {
        "started_at": datetime.now(UTC).isoformat(),
        "upstream_host": urlparse(settings.ai_base_url).hostname,
        "model": settings.ai_model,
        "isolated_data": str(data),
        "fixture_notice": "AI-generated visual fixtures, not real operational incidents. "
        "Two reports verify real connectivity. Before/after reuse the SAME mountain photo; "
        "rectification verifies the deterministic no-new-evidence guard, not a model call.",
        "calls": [],
        "passed": False,
    }
    records = []
    try:
        with httpx.Client(
            base_url=origin, timeout=settings.ai_timeout_seconds + 15, trust_env=False
        ) as client:
            for _ in range(100):
                if server.started:
                    break
                time.sleep(0.1)
            assert server.started, "Isolated HTTP server failed to start"

            def request(method: str, path: str, **kwargs) -> dict:
                """Validate HTTP responses without logging headers or scoped credentials."""
                response = client.request(method, path, **kwargs)
                if response.is_error:
                    body = response.json().get("error", {})
                    raise RuntimeError(f"HTTP {response.status_code}: {body.get('code')}")
                return response.json()

            def upload(filename: str) -> dict:
                """Send a real multipart upload, letting the app normalize the picture."""
                path = ROOT / "frontend/public/assets" / filename
                with path.open("rb") as photo:
                    return request(
                        "POST", "/api/uploads", files={"file": (filename, photo, "image/png")}
                    )

            for filename, scenic, point in (
                ("terracotta.png", "terracotta-demo", "terracotta-entry"),
                ("taibai.png", "qinling-demo", "trail-entrance"),
            ):
                created = request(
                    "POST",
                    "/api/events",
                    json={
                        "scenic_id": scenic,
                        "point_id": point,
                        "is_demo": True,
                        "description": "模型连通验收：AI 生成意境图。"
                        "请只描述实际可见内容，不推断现场事故。",
                        "original_images": [upload(filename)],
                    },
                )
                event_id, token = created["event"]["id"], created["query_token"]
                headers = {"X-Visitor-Token": token}
                started = time.monotonic()
                try:
                    event = request(
                        "POST",
                        f"/api/events/{event_id}/analysis",
                        headers=headers,
                        json={"kind": "report"},
                    )
                finally:
                    saved = request("GET", f"/api/events/{event_id}", headers=headers)
                    analysis = saved["analyses"][-1]
                    evidence["calls"].append(
                        {
                            "kind": "report",
                            "fixture": filename,
                            "sha256": hashlib.sha256(
                                (ROOT / "frontend/public/assets" / filename).read_bytes()
                            ).hexdigest(),
                            "status": analysis["status"],
                            "model": analysis["model"],
                            "started_at": analysis["started_at"],
                            "finished_at": analysis["finished_at"],
                            "elapsed_ms": round((time.monotonic() - started) * 1000),
                            "result": analysis["result"],
                            "error": analysis["error"],
                            "persisted_after_get": True,
                        }
                    )
                assert event["ai_status"]["report"] == "succeeded"
                assert analysis["result"] and analysis["status"] == "succeeded"
                records.append(
                    {
                        "id": event_id,
                        "token": token,
                        "kind": "care",
                        "scenic": scenic,
                        "title": "真实模型连通验收",
                        "image": saved["original_images"][0]["url"],
                        "date": saved["created_at"],
                    }
                )
                print(
                    f"Report {filename}: succeeded ({evidence['calls'][-1]['elapsed_ms']} ms)",
                    flush=True,
                )
            assert evidence["calls"][0]["result"] != evidence["calls"][1]["result"], (
                "Distinct fixtures returned identical results"
            )
            session = request(
                "POST",
                "/api/auth/login",
                json={"username": isolated.demo_admin_username, "password": password},
            )
            admin_token = session["access_token"]
            admin = {"Authorization": f"Bearer {admin_token}"}
            event_id = records[-1]["id"]
            request(
                "POST",
                f"/api/events/{event_id}/actions",
                headers=admin,
                json={"action": "assign", "assignee": "隔离验收组"},
            )
            request(
                "POST",
                f"/api/events/{event_id}/actions",
                headers=admin,
                json={
                    "action": "submit_resolution",
                    "resolution_images": [upload("taibai.png")],
                    "note": "连通测试：前后为同一张 AI 生成山景图，并未进行现场整改。请如实比较。",
                },
            )
            started = time.monotonic()
            try:
                event = request(
                    "POST",
                    f"/api/events/{event_id}/analysis",
                    headers=admin,
                    json={"kind": "resolution"},
                )
            finally:
                saved = request("GET", f"/api/events/{event_id}", headers=admin)
                analysis = saved["analyses"][-1]
                evidence["calls"].append(
                    {
                        "kind": "resolution",
                        "fixture": "taibai.png -> SAME taibai.png",
                        "status": analysis["status"],
                        "model": analysis["model"],
                        "started_at": analysis["started_at"],
                        "finished_at": analysis["finished_at"],
                        "elapsed_ms": round((time.monotonic() - started) * 1000),
                        "result": analysis["result"],
                        "error": analysis["error"],
                        "persisted_after_get": True,
                    }
                )
            assert event["ai_status"]["resolution"] == "succeeded" and analysis["result"]
            assert analysis["model"] == "system:sha256"
            assert analysis["result"]["same_image"]
            print("Same-image guard: succeeded (no rectification model call)", flush=True)
            node = os.environ.get("NODE_EXECUTABLE") or shutil.which("node")
            assert node, "Node is required for real-result browser verification"
            subprocess.run(
                [node, str(ROOT / "scripts/live_ai_browser.mjs")],
                input=json.dumps(
                    {
                        "origin": origin,
                        "records": records,
                        "adminToken": admin_token,
                        "evidence": str(data),
                    }
                ),
                text=True,
                encoding="utf-8",
                check=True,
                cwd=ROOT,
                env=os.environ.copy(),
            )
            evidence["browser_verified"] = True
            evidence["passed"] = True
    except Exception as exc:
        evidence["failure"] = str(exc)
        raise
    finally:
        evidence["finished_at"] = datetime.now(UTC).isoformat()
        calls = data / "ai_calls.jsonl"
        evidence["upstream_calls"] = (
            [json.loads(line) for line in calls.read_text(encoding="utf-8").splitlines()]
            if calls.exists()
            else []
        )
        path = data / "evidence.json"
        path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Evidence retained: {path}", flush=True)
        server.should_exit = True
        thread.join(timeout=10)


if __name__ == "__main__":
    run()

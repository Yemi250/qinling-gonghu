"""Verify the upgrade against a real model using labeled synthetic photos and isolated data."""

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
    """Persist real proof runs, drive actual browser actions, and retain sanitized evidence."""
    settings = Settings()
    if not settings.ai_api_key:
        raise SystemExit("AI_API_KEY is not configured; no real-call success claimed.")
    data = Path(tempfile.mkdtemp(prefix="gonghu-live-upgrade-"))
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
        "model": settings.ai_model,
        "upstream_host": urlparse(settings.ai_base_url).hostname,
        "isolated_data": str(data),
        "fixture_notice": "AI-generated, visibly labeled simulation; not real incidents. "
        "Successful calls validate connectivity and workflow, not real-world accuracy.",
        "proof_runs": [],
        "passed": False,
    }
    records = []
    try:
        with httpx.Client(
            base_url=origin, timeout=settings.ai_timeout_seconds + 20, trust_env=False
        ) as client:
            for _ in range(100):
                if server.started:
                    break
                time.sleep(0.1)
            assert server.started, "Isolated server did not start"

            def request(method: str, path: str, **kwargs) -> dict:
                """Validate status without logging headers, passwords, or scoped tokens."""
                response = client.request(method, path, **kwargs)
                if response.is_error:
                    raise RuntimeError(
                        f"HTTP {response.status_code}: "
                        f"{response.json().get('error', {}).get('code')}"
                    )
                return response.json()

            visitor_session = request(
                "POST",
                "/api/visitor/register",
                json={
                    "username": "live_visitor",
                    "password": password,
                    "confirm_password": password,
                    "nickname": "隔离模型验收",
                },
            )
            client.headers["X-Gonghu-CSRF"] = visitor_session["csrf_token"]

            def create(filename: str, description: str) -> dict:
                """Normalize a real multipart upload before creating its scoped event."""
                path = ROOT / "docs/demo-fixtures" / filename
                with path.open("rb") as photo:
                    image = request(
                        "POST", "/api/uploads", files={"file": (filename, photo, "image/png")}
                    )
                created = request(
                    "POST",
                    "/api/events",
                    json={
                        "scenic_id": "qinling-demo",
                        "point_id": "trail-entrance",
                        "is_demo": True,
                        "description": description,
                        "original_images": [image],
                    },
                )
                event = created["event"]
                record = {
                    "id": event["id"],
                    "token": created["query_token"],
                    "kind": "care",
                    "scenic": "太白山",
                    "title": description,
                    "image": event["original_images"][0]["url"],
                    "date": event["created_at"],
                }
                records.append(record)
                return record

            def prove(record: dict) -> dict:
                """Start the saved background pipeline and poll its real persisted stages."""
                headers = {"X-Visitor-Token": record["token"]}
                started = time.monotonic()
                request("POST", f"/api/events/{record['id']}/proof", headers=headers)
                while time.monotonic() - started < 240:
                    event = request("GET", f"/api/events/{record['id']}", headers=headers)
                    if event["proof"]["status"] != "running":
                        evidence["proof_runs"].append(
                            {
                                "event_id": event["id"],
                                "proof": event["proof"],
                                "analyses": event["analyses"],
                                "merged_into": event["merged_into"],
                            }
                        )
                        assert event["proof"]["status"] == "succeeded", event["proof"]
                        print(
                            f"Proof {len(evidence['proof_runs'])}: succeeded "
                            f"({round(time.monotonic() - started, 1)} s)",
                            flush=True,
                        )
                        return event
                    time.sleep(0.3)
                raise TimeoutError("Real proof run did not finish")

            first = create("litter-before.png", "模拟演示：入口休息区垃圾桶旁有散落垃圾。")
            prove(first)
            second = create("litter-before.png", "模拟演示：同一张照片再次投稿，用于重复线索测试。")
            duplicate = prove(second)
            session = request(
                "POST",
                "/api/auth/login",
                json={
                    "username": isolated.demo_admin_username,
                    "password": password,
                },
            )
            admin = {"Authorization": f"Bearer {session['access_token']}"}
            evidence["duplicate_automatically_merged"] = duplicate["merged_into"] == first["id"]
            if not duplicate["merged_into"]:
                # Disagreeing classifications legitimately require human confirmation.
                candidates = request(
                    "GET", f"/api/events/{second['id']}/associations", headers=admin
                )["candidates"]
                candidate = next(c for c in candidates if c["id"] == first["id"])
                assert candidate["exact"] and not candidate["stale"]
                request(
                    "POST",
                    f"/api/events/{second['id']}/merge",
                    headers=admin,
                    json={
                        "target_event_id": first["id"],
                        "source_revision": duplicate["revision"],
                        "target_revision": candidate["version"],
                        "reason": "隔离验收：管理员核对重复照片后确认关联。",
                    },
                )
                print(
                    "Exact photo: strict automatic gates did not qualify; administrator confirmed.",
                    flush=True,
                )
            else:
                print("Exact photo: strict automatic merge qualified and succeeded.", flush=True)
            create("litter-angle.png", "模拟演示：换一个角度记录相同休息区的散落垃圾。")
            node = os.environ.get("NODE_EXECUTABLE") or shutil.which("node")
            assert node, "Node is required for browser verification"
            subprocess.run(
                [node, str(ROOT / "scripts/live_upgrade_browser.mjs")],
                input=json.dumps(
                    {
                        "origin": origin,
                        "visitorCookie": client.cookies.get("gonghu_visitor"),
                        "records": records,
                        "adminToken": session["access_token"],
                        "evidence": str(data),
                        "afterFixture": str(ROOT / "docs/demo-fixtures/litter-after.png"),
                    }
                ),
                text=True,
                encoding="utf-8",
                check=True,
                cwd=ROOT,
                env=os.environ.copy(),
            )
            admin = {"Authorization": f"Bearer {session['access_token']}"}
            final = request("GET", f"/api/events/{first['id']}", headers=admin)
            assert final["status"] == "closed"
            assert final["governance"]["submission_count"] == 3
            assert final["governance"]["unique_image_count"] == 2
            assert final["governance"]["duplicate_image_count"] == 1
            review = [a for a in final["analyses"] if a["kind"] == "resolution"][-1]
            assert review["status"] == "succeeded" and not review["stale"]
            assert not review["result"]["same_image"]
            assert review["model"] == settings.ai_model
            evidence["rectification"] = review
            for record in records:
                saved = request(
                    "GET",
                    f"/api/events/{record['id']}",
                    headers={"X-Visitor-Token": record["token"]},
                )
                assert saved["governance"]["status"] == "closed"
                assert "candidates" not in saved["proof"]
                forbidden = client.get(
                    f"/api/events/{record['id']}/associations",
                    headers={"X-Visitor-Token": record["token"]},
                )
                assert forbidden.status_code == 401
            # Negative control: exactly reused rectification image must skip the provider.
            negative = create("litter-before.png", "模拟演示：同图整改检查的隔离负例。")
            request(
                "POST",
                f"/api/events/{negative['id']}/actions",
                headers=admin,
                json={"action": "assign", "assignee": "隔离验收组"},
            )
            path = ROOT / "docs/demo-fixtures/litter-before.png"
            with path.open("rb") as photo:
                image = request(
                    "POST", "/api/uploads", files={"file": (path.name, photo, "image/png")}
                )
            request(
                "POST",
                f"/api/events/{negative['id']}/actions",
                headers=admin,
                json={
                    "action": "submit_resolution",
                    "resolution_images": [image],
                    "note": "负例：未提交新的整改证据。",
                },
            )
            same = request(
                "POST",
                f"/api/events/{negative['id']}/analysis",
                headers=admin,
                json={"kind": "resolution"},
            )
            guard = same["analyses"][-1]
            assert guard["model"] == "system:sha256" and guard["result"]["same_image"]
            assert guard["result"]["suggestion"] == "need_human"
            assert same["status"] == "pending_acceptance"
            evidence["same_image_guard"] = guard
            evidence["browser_verified"] = True
            evidence["passed"] = True
            evidence["fixtures"] = [
                {"file": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                for p in sorted((ROOT / "docs/demo-fixtures").glob("*.png"))
            ]
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

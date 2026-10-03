"""Offline workflow tests with explicitly labeled provider doubles; no claimed model accuracy."""

import asyncio
import json
import sqlite3
import time
from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.db import SCHEMA, Database
from backend.app.main import create_app
from backend.tests.test_analysis import TestProvider, report_output
from backend.tests.test_api import act, admin, upload


class ProofProvider(TestProvider):
    """Deterministic test provider; never installed in the running product."""

    def __init__(self):
        super().__init__(result=report_output(verdict="ok"))
        self.compare_error = False
        self.compare_calls = 0
        self.review_calls = 0

    async def compare_reports(self, **kwargs):
        self.compare_calls += 1
        if self.compare_error:
            raise RuntimeError("private-upstream-secret")
        return {
            "relation": "same_issue",
            "reasons": ["测试替身：相同场景参照物"],
            "uncertainties": ["测试替身，不代表真实模型判断"],
        }

    async def review_resolution(self, **kwargs):
        self.review_calls += 1
        result = await super().review_resolution(**kwargs)
        result["suggestion"] = "recommend_accept"
        return result


def create_submission(client, color="green", point="trail-entrance", demo=True):
    """Create real uploads and scoped receipts with constructed offline image fixtures."""
    response = client.post(
        "/api/events",
        json={
            "scenic_id": "qinling-demo",
            "point_id": point,
            "description": "明确标注的离线测试材料",
            "original_images": [upload(client, color)],
            "is_demo": demo,
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()
    return data["event"], {"X-Visitor-Token": data["query_token"]}


def proof(client, event, credentials):
    """Wait on persisted status instead of assuming a button click means successful analysis."""
    started = client.post(f"/api/events/{event['id']}/proof", headers=credentials)
    assert started.status_code == 202, started.text
    for _ in range(500):
        current = client.get(f"/api/events/{event['id']}", headers=credentials).json()
        if current["proof"]["status"] != "running":
            return current
        time.sleep(0.01)
    raise AssertionError("Offline proof task did not complete")


def test_exact_duplicate_shared_closure_and_scoped_receipts(client):
    provider = ProofProvider()
    client.app.state.ai = provider
    root, root_token = create_submission(client)
    assert proof(client, root, root_token)["proof"]["status"] == "succeeded"
    child, child_token = create_submission(client)
    result = proof(client, child, child_token)
    assert result["merged_into"] == root["id"]
    assert result["proof"]["stale"] is False
    assert provider.compare_calls == 0  # Exact byte checks are not mislabeled as model calls.
    summary = result["governance"]
    assert (
        summary["submission_count"],
        summary["unique_image_count"],
        summary["duplicate_image_count"],
    ) == (2, 1, 1)
    overview = client.get("/api/overview").json()
    assert (overview["total"], overview["submission_count"], overview["today_count"]) == (1, 2, 2)
    assert client.get(f"/api/events/{root['id']}", headers=child_token).status_code == 403
    assert (
        client.get(f"/api/events/{child['id']}/associations", headers=child_token).status_code
        == 401
    )
    assert "candidates" not in result["proof"]
    assert result["original_images"][0]["id"] != root["original_images"][0]["id"]
    manager = admin(client)
    assert client.get("/api/events", headers=manager).json()["total"] == 1
    assert act(client, child["id"], manager, "assign", assignee="测试").status_code == 409
    act(client, root["id"], manager, "assign", assignee="测试保洁")
    act(
        client,
        root["id"],
        manager,
        "submit_resolution",
        note="测试整改",
        resolution_images=[upload(client, "blue")],
    )
    review = client.post(
        f"/api/events/{root['id']}/analysis", headers=manager, json={"kind": "resolution"}
    )
    assert review.status_code == 200
    assert review.json()["status"] == "pending_acceptance"
    act(client, root["id"], manager, "close", note="人工核验测试通过")
    echo = client.get(f"/api/events/{child['id']}", headers=child_token).json()
    assert echo["governance"]["status"] == "closed"
    assert echo["governance"]["closing_note"] == "人工核验测试通过"
    assert echo["resolution_images"] == []
    assert root["original_images"][0]["id"] not in json.dumps(echo)


def test_dhash_collision_requires_model_and_human_confirm_then_undo(client):
    client.app.state.ai = ProofProvider()
    root, token = create_submission(client, "green")
    proof(client, root, token)
    child, child_token = create_submission(client, "blue")
    analyzed = proof(client, child, child_token)
    assert analyzed["merged_into"] is None
    assert client.app.state.ai.compare_calls == 1
    manager = admin(client)
    candidates = client.get(f"/api/events/{child['id']}/associations", headers=manager).json()
    candidate = candidates["candidates"][0]
    assert candidate["dhash_distance"] == 0 and candidate["exact"] is False
    merged = client.post(
        f"/api/events/{child['id']}/merge",
        headers=manager,
        json={
            "target_event_id": root["id"],
            "source_revision": analyzed["revision"],
            "target_revision": candidate["version"],
            "reason": "人工比对测试场景后确认",
        },
    )
    assert merged.status_code == 200, merged.text
    assert merged.json()["governance"]["unique_image_count"] == 2
    assert merged.json()["proof"]["stale"] is True
    version = merged.json()["relationship_version"]
    assert (
        client.post(
            f"/api/events/{child['id']}/unmerge",
            headers=child_token,
            json={"relationship_version": version, "reason": "越权"},
        ).status_code
        == 401
    )
    detached = client.post(
        f"/api/events/{child['id']}/unmerge",
        headers=manager,
        json={"relationship_version": version, "reason": "测试撤销误归并"},
    )
    assert detached.status_code == 200
    assert detached.json()["merged_into"] is None
    assert client.get("/api/overview").json()["total"] == 2
    assert client.get(f"/api/events/{child['id']}", headers=child_token).status_code == 200


def test_waste_category_disagreement_with_distant_fingerprints_still_gets_model_candidate(client):
    """Different-angle waste photos must reach semantic comparison without weakening auto-merge."""
    provider = ProofProvider()
    client.app.state.ai = provider

    def gradient_submission(reverse):
        """Upload actual opposite gradients so dHash filtering alone cannot associate them."""
        image = Image.new("RGB", (128, 128))
        image.putdata(
            [(255 - x * 2 if reverse else x * 2,) * 3 for _ in range(128) for x in range(128)]
        )
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        claim = client.post(
            "/api/uploads", files={"file": ("test.png", buffer.getvalue(), "image/png")}
        ).json()
        data = client.post(
            "/api/events",
            json={
                "scenic_id": "qinling-demo",
                "point_id": "trail-entrance",
                "is_demo": True,
                "description": "离线梯度测试，不是真实垃圾照片",
                "original_images": [claim],
            },
        ).json()
        return data["event"], {"X-Visitor-Token": data["query_token"]}

    root, token = gradient_submission(False)
    proof(client, root, token)
    provider.result = report_output(verdict="ok", category="waste_pile")
    child, token = gradient_submission(True)
    result = proof(client, child, token)
    assert result["proof"]["status"] == "succeeded" and result["merged_into"] is None
    candidate = client.get(f"/api/events/{child['id']}/associations", headers=admin(client)).json()[
        "candidates"
    ][0]
    assert candidate["id"] == root["id"] and candidate["dhash_distance"] > 6
    assert candidate["exact"] is False and provider.compare_calls == 1


@pytest.mark.parametrize("boundary", ["other_point", "other_demo", "old", "closed", "smoke"])
def test_no_unsafe_automatic_merge(client, boundary):
    provider = ProofProvider()
    client.app.state.ai = provider
    if boundary == "smoke":
        provider.result = report_output(verdict="ok", category="suspected_smoke")
    root, token = create_submission(client)
    proof(client, root, token)
    manager = admin(client)
    if boundary == "old":
        timestamp = (datetime.now(UTC) - timedelta(hours=3)).isoformat()
        with client.app.state.db.transaction() as conn:
            conn.execute("UPDATE events SET created_at=? WHERE id=?", (timestamp, root["id"]))
    if boundary == "closed":
        act(client, root["id"], manager, "assign", assignee="测试保洁")
        act(
            client,
            root["id"],
            manager,
            "submit_resolution",
            note="测试整改",
            resolution_images=[upload(client, "blue")],
        )
        act(client, root["id"], manager, "close", note="人工验收")
    child, credentials = create_submission(
        client,
        point="rest-area" if boundary == "other_point" else "trail-entrance",
        demo=boundary != "other_demo",
    )
    result = proof(client, child, credentials)
    assert result["proof"]["status"] == "succeeded"
    assert result["merged_into"] is None


def test_same_image_review_skips_model_and_never_recommends_accept(client):
    provider = ProofProvider()
    client.app.state.ai = provider
    root, token = create_submission(client)
    proof(client, root, token)
    manager = admin(client)
    act(client, root["id"], manager, "assign", assignee="测试保洁")
    act(
        client,
        root["id"],
        manager,
        "submit_resolution",
        note="原图重复的负对照",
        resolution_images=[upload(client)],
    )
    response = client.post(
        f"/api/events/{root['id']}/analysis", headers=manager, json={"kind": "resolution"}
    )
    assert response.status_code == 200
    result = response.json()["analyses"][-1]["result"]
    assert result["same_image"] and result["suggestion"] == "need_human"
    assert provider.review_calls == 0
    assert response.json()["status"] == "pending_acceptance"


def test_changed_target_rejects_old_candidate_and_group_reviews_keep_photos_private(client):
    """Version guards and view scoping remain valid after a different-photo manual association."""
    provider = ProofProvider()
    client.app.state.ai = provider
    root, root_token = create_submission(client)
    proof(client, root, root_token)
    child, child_token = create_submission(client, "blue")
    analyzed = proof(client, child, child_token)
    manager = admin(client)
    candidate = client.get(f"/api/events/{child['id']}/associations", headers=manager).json()[
        "candidates"
    ][0]
    act(client, root["id"], manager, "assign", assignee="人工接力")
    body = {
        "target_event_id": root["id"],
        "source_revision": analyzed["revision"],
        "target_revision": candidate["version"],
        "reason": "过期候选测试",
    }
    assert (
        client.post(f"/api/events/{child['id']}/merge", headers=manager, json=body).status_code
        == 409
    )
    analyzed = proof(client, child, child_token)
    candidate = client.get(f"/api/events/{child['id']}/associations", headers=manager).json()[
        "candidates"
    ][0]
    body.update(source_revision=analyzed["revision"], target_revision=candidate["version"])
    assert (
        client.post(f"/api/events/{child['id']}/merge", headers=manager, json=body).status_code
        == 200
    )
    act(
        client,
        root["id"],
        manager,
        "submit_resolution",
        note="测试整改",
        resolution_images=[upload(client, "red")],
    )
    reviewed = client.post(
        f"/api/events/{root['id']}/analysis", headers=manager, json={"kind": "resolution"}
    ).json()
    assert len(reviewed["analyses"][-1]["result"]["reviewed_images"]) == 2
    public = client.get(f"/api/events/{root['id']}", headers=root_token).json()
    child_image_id = child["original_images"][0]["id"]
    assert child_image_id not in json.dumps(public)
    assert len(public["analyses"][-1]["result"]["reviewed_images"]) == 1
    assert (
        client.post(
            f"/api/events/{child['id']}/unmerge",
            headers=manager,
            json={
                "relationship_version": client.get(
                    f"/api/events/{child['id']}", headers=manager
                ).json()["relationship_version"],
                "reason": "新增核验后撤销测试",
            },
        ).status_code
        == 200
    )
    fresh = client.get(f"/api/events/{root['id']}", headers=manager).json()
    assert fresh["analyses"][-1]["stale"] is True


def test_comparison_failure_is_partial_and_redacted(client):
    provider = ProofProvider()
    client.app.state.ai = provider
    root, token = create_submission(client)
    proof(client, root, token)
    provider.compare_error = True
    child, credentials = create_submission(client, "blue")
    result = proof(client, child, credentials)
    assert result["proof"]["status"] == "partial"
    assert result["proof"]["steps"][1]["state"] == "pass"
    assert result["merged_into"] is None
    assert "private-upstream-secret" not in json.dumps(result)


def test_reuse_running_task_and_human_state_change_prevents_late_merge(client):
    entered = asyncio.Event()

    class SlowProof(ProofProvider):
        async def analyze_report(self, **kwargs):
            entered.set()
            await asyncio.sleep(0.25)
            return self.result

    client.app.state.ai = SlowProof()
    event, credentials = create_submission(client)
    first = client.post(f"/api/events/{event['id']}/proof", headers=credentials)
    second = client.post(f"/api/events/{event['id']}/proof", headers=credentials)
    assert first.json()["id"] == second.json()["id"]
    manager = admin(client)
    assert act(client, event["id"], manager, "assign", assignee="人工已接力").status_code == 200
    for _ in range(100):
        result = client.get(f"/api/events/{event['id']}", headers=credentials).json()
        if result["proof"]["status"] != "running":
            break
        time.sleep(0.01)
    assert result["proof"]["status"] == "failed"
    assert result["status"] == "processing"


def test_v1_backup_upgrade_and_restart_recovery(settings):
    """Validate a populated old schema, preserved upload columns and interrupted run recovery."""
    settings.data_dir.mkdir(exist_ok=True)
    old_path = settings.data_dir / "events.sqlite3"
    with sqlite3.connect(old_path) as conn:
        conn.executescript(SCHEMA + "PRAGMA user_version=1;")
        conn.execute(
            "INSERT INTO uploads VALUES(?,?,?,?,?,?,NULL,?)",
            ("preserved", "old.jpg", "image/jpeg", 10, "digest", "token", "old-time"),
        )
    db = Database(settings.data_dir)
    db.initialize()
    backups = list((settings.data_dir / "backups").glob("before-v2-*.sqlite3"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
        assert conn.execute("SELECT path FROM uploads").fetchone()[0] == "old.jpg"
    with db.connect() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
        assert conn.execute("SELECT path,dhash FROM uploads").fetchone()[0] == "old.jpg"
    with TestClient(create_app(settings, ai=ProofProvider())) as client:
        event, credentials = create_submission(client)
        proof(client, event, credentials)
        with client.app.state.db.transaction() as conn:
            conn.execute("UPDATE proof_runs SET status='running',finished_at=NULL")
    with TestClient(create_app(settings, ai=ProofProvider())) as client:
        saved = client.get(f"/api/events/{event['id']}", headers=credentials).json()
        assert saved["proof"]["status"] == "failed"
        assert "重启" in saved["proof"]["error"]
        assert proof(client, saved, credentials)["proof"]["status"] == "succeeded"
    assert len(list((settings.data_dir / "backups").glob("before-v2-*.sqlite3"))) == 1

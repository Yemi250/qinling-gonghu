"""Account isolation and reversible participation rewards using real endpoints, not model claims."""

import sqlite3
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.db import SCHEMA, UPGRADE, Database, now
from backend.app.main import create_app
from backend.app.rewards import SCENICS
from backend.app.visitor_auth import password_hash, password_matches
from backend.tests.test_api import act, admin, report, upload, visitor_login
from backend.tests.test_proof import ProofProvider, create_submission, proof


def account(client, name="second_visitor", *, register=True):
    """Create or sign into a separate isolated account through its cookie-based API."""
    body = {"username": name, "password": "visitor-test-only"}
    if register:
        body.update(confirm_password=body["password"], nickname="山河测试")
    response = client.post("/api/visitor/" + ("register" if register else "login"), json=body)
    assert response.status_code == (201 if register else 200), response.text
    client.headers["X-Gonghu-CSRF"] = response.json()["csrf_token"]
    return response.json()


def snapshot(client):
    """Read the actual account snapshot after each independently observed mutation."""
    response = client.get("/api/visitor/me/passport")
    assert response.status_code == 200, response.text
    return response.json()


def memory(client, scenic="terracotta-demo", color="red"):
    """Save a normalized synthetic image, with the same privacy checks as a real postcard."""
    response = client.post(
        "/api/postcards",
        json={
            "scenic_id": scenic,
            "description": "隔离收藏测试",
            "images": [upload(client, color)],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def review(client, manager, event_id, decision):
    """Use fresh server revisions so tests cover the administrator's actual review contract."""
    current = client.get(f"/api/events/{event_id}", headers=manager).json()
    response = client.post(
        f"/api/events/{event_id}/contribution",
        headers=manager,
        json={"decision": decision, "note": "隔离审核与纠正测试", "revision": current["revision"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_password_derivation_and_registration_validation(client):
    """Verify random salts and independent PBKDF2 settings instead of legacy admin hashing."""
    first, second = password_hash("test-only-password"), password_hash("test-only-password")
    assert first != second and first.startswith("pbkdf2_sha256$600000$")
    assert len(first.split("$")[2]) == 32
    assert password_matches("test-only-password", first)
    assert not password_matches("wrong-password", first)
    duplicate = client.post(
        "/api/visitor/register",
        json={
            "username": "FIXTURE_VISITOR",
            "password": "fixture-visitor-only",
            "confirm_password": "fixture-visitor-only",
        },
    )
    assert duplicate.status_code == 409
    for username, password, confirm in [
        ("aa", "12345678", "12345678"),
        ("中文账号", "12345678", "12345678"),
        ("good_user", "1234567", "1234567"),
        ("good_user", "12345678", "87654321"),
    ]:
        response = client.post(
            "/api/visitor/register",
            json={
                "username": username,
                "password": password,
                "confirm_password": confirm,
            },
        )
        assert response.status_code == 422
    bad = client.post(
        "/api/visitor/login", json={"username": "fixture_visitor", "password": "wrong-password"}
    )
    assert bad.status_code == 401
    assert "password_hash" not in client.get("/api/visitor/me").text


def test_login_cookies_csrf_origin_logout_expiry_and_rate_limit(client):
    """Cross-site writes, stale sessions and administrator image cookies confer no write powers."""
    session = account(client)
    assert session["user"]["nickname"] == "山河测试"
    cookie = client.cookies.get("gonghu_visitor")
    assert cookie and session["csrf_token"] != cookie
    path = "/api/visitor/explore/terracotta-demo"
    assert client.post(path, headers={"X-Gonghu-CSRF": ""}).status_code == 403
    assert client.post(path, headers={"Origin": "https://foreign.example"}).status_code == 403
    assert client.post(path, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert client.post(path, headers={"Origin": "http://testserver"}).status_code == 200
    manager = admin(client)
    assert client.get("/api/events").status_code == 401  # image cookie is not an API grant
    assert client.post("/api/visitor/logout").status_code == 204
    assert client.get("/api/visitor/me").json()["user"] is None
    assert client.get("/api/events", headers=manager).status_code == 200
    assert client.post(path).status_code == 401
    account(client, register=False)
    with client.app.state.db.transaction() as conn:
        conn.execute("UPDATE visitor_sessions SET expires_at='2000-01-01T00:00:00+00:00'")
    assert client.get("/api/visitor/me/passport").status_code == 401
    client.app.state.visitor_attempts.clear()
    responses = [
        client.post(
            "/api/visitor/login", json={"username": "bad_user", "password": "wrong-password"}
        )
        for _ in range(11)
    ]
    assert responses[-1].status_code == 429


def test_secure_cookie_and_same_account_cross_device(client, settings):
    """A second browser sees server records without copying local capability tokens."""
    card = memory(client)["postcard"]
    with TestClient(create_app(settings)) as device:
        visitor_login(device)
        assert device.get("/api/postcards/" + card["id"]).status_code == 200
        assert device.get(card["images"][0]["url"]).status_code == 200
        assert snapshot(device)["summary"]["guardian_value"] == 10
    settings.visitor_cookie_secure = False
    with TestClient(create_app(settings), base_url="https://testserver") as secure:
        response = secure.post(
            "/api/visitor/login",
            json={"username": "fixture_visitor", "password": "fixture-visitor-only"},
        )
        header = response.headers["set-cookie"].lower()
        assert all(
            word in header for word in ("secure", "httponly", "samesite=lax", "max-age=604800")
        )


def test_foreign_accounts_cannot_read_records_images_or_claim_uploads(client):
    """Even possession of a new retrieval/upload capability does not override account ownership."""
    postcard = memory(client)
    event, token = report(client)
    unclaimed = upload(client, "yellow")
    second = TestClient(client.app)
    account(second)
    for path in [f"/api/postcards/{postcard['postcard']['id']}", f"/api/events/{event['id']}"]:
        assert second.get(path).status_code == 403
    assert second.get(f"/api/events/{event['id']}", headers=token).status_code == 403
    assert second.get("/api/visitor/me/records").json()["total"] == 0
    assert all(second.get(i["url"]).status_code == 403 for i in event["original_images"])
    assert second.get(postcard["postcard"]["images"][0]["url"]).status_code == 403
    assert (
        second.post(
            "/api/postcards",
            json={"scenic_id": "terracotta-demo", "description": "越权", "images": [unclaimed]},
        ).status_code
        == 403
    )
    assert (
        client.get(f"/api/events/{event['id']}", headers={**token, "Cookie": ""}).status_code == 401
    )
    assert second.get("/api/events").status_code == 401
    buffer = BytesIO()
    Image.new("RGB", (4, 4)).save(buffer, "PNG")
    assert (
        second.post(
            "/api/uploads",
            headers={"Cookie": ""},
            files={"file": ("x.png", buffer.getvalue(), "image/png")},
        ).status_code
        == 401
    )


def test_exploration_memory_limits_and_all_six_badge_progress(client):
    """Replays and copied images cannot inflate server-issued points, even across destinations."""
    for scenic in SCENICS:
        for _ in range(2):
            assert client.post("/api/visitor/explore/" + scenic).status_code == 200
    memory(client, "terracotta-demo", "red")
    memory(client, "terracotta-demo", "blue")
    memory(client, "huashan-demo", "red")  # already rewarded at another destination
    assert snapshot(client)["summary"]["guardian_value"] == 40
    memory(client, "huashan-demo", "yellow")
    passport = snapshot(client)
    assert passport["summary"]["guardian_value"] == 50
    assert passport["summary"]["memory_count"] == 4
    assert {b["id"] for b in passport["badges"] if b["earned"]} == {
        "departure",
        "collector",
        "wanderer",
        "six-scenes",
    }
    assert all(s["tasks"][0]["state"] == "completed" for s in passport["scenes"])
    page = client.get(
        "/api/visitor/me/records?kind=memory&scenic_id=huashan-demo&limit=1&offset=1"
    ).json()
    assert page["total"] == 2 and len(page["items"]) == 1
    assert page["items"][0]["scenic_id"] == "huashan-demo"
    assert client.get("/api/visitor/me/rewards").json()["total"] == 8
    assert client.post("/api/visitor/explore/no-such-scenic").status_code == 422


def test_contribution_requires_approval_correction_keeps_adjustments_and_badges(client):
    """Upload/analysis/retry is not a contribution; review corrections revoke value and medals."""
    event, token = report(client)
    client.app.state.ai = ProofProvider()
    proof(client, event, token)
    proof(client, event, token)
    assert snapshot(client)["summary"]["guardian_value"] == 0
    manager = admin(client)
    assert act(client, event["id"], manager, "assign", assignee="测试保洁").status_code == 200
    assert snapshot(client)["summary"]["guardian_value"] == 20
    act(
        client,
        event["id"],
        manager,
        "submit_resolution",
        note="测试整改",
        resolution_images=[upload(client, "blue")],
    )
    act(client, event["id"], manager, "close", note="人工验收测试")
    assert {b["id"] for b in snapshot(client)["badges"] if b["earned"]} == {"guardian", "echo"}
    assert review(client, manager, event["id"], "rejected")["valid"] is False
    assert snapshot(client)["summary"]["guardian_value"] == 0
    assert all(not b["earned"] for b in snapshot(client)["badges"])
    review(client, manager, event["id"], "accepted")
    review(client, manager, event["id"], "accepted")
    changes = client.get("/api/visitor/me/rewards").json()["items"]
    assert [r["delta"] for r in changes] == [20, -20, 20]


def test_duplicate_photos_across_accounts_never_reward_independent_contribution(client):
    """A second account copying the same normalized photo is not a second contributor."""
    first, _ = report(client)
    manager = admin(client)
    act(client, first["id"], manager, "assign", assignee="隔离组")
    second = TestClient(client.app)
    account(second)
    duplicate, _ = report(second)
    act(client, duplicate["id"], manager, "assign", assignee="隔离组")
    accepted = review(client, manager, duplicate["id"], "accepted")
    assert not accepted["independent"] and not accepted["valid"]
    assert snapshot(client)["summary"]["guardian_value"] == 20
    assert snapshot(second)["summary"]["guardian_value"] == 0


def test_merge_children_explicit_approval_and_undo_reconcile_rewards(client):
    """A distinct merged photo needs individual approval; an undo retracts unqualified value."""
    client.app.state.ai = ProofProvider()
    root, root_token = create_submission(client, "green")
    proof(client, root, root_token)
    with TestClient(client.app) as second:
        account(second)
        child, child_token = create_submission(second, "blue")
        analyzed = proof(second, child, child_token)
        manager = admin(client)
        candidate = client.get(f"/api/events/{child['id']}/associations", headers=manager).json()[
            "candidates"
        ][0]
        merged = client.post(
            f"/api/events/{child['id']}/merge",
            headers=manager,
            json={
                "target_event_id": root["id"],
                "source_revision": analyzed["revision"],
                "target_revision": candidate["version"],
                "reason": "隔离人工关联",
            },
        )
        assert merged.status_code == 200, merged.text
        act(client, root["id"], manager, "assign", assignee="隔离组")
        assert snapshot(second)["summary"]["guardian_value"] == 0
        assert review(client, manager, child["id"], "accepted")["valid"]
        assert snapshot(second)["summary"]["guardian_value"] == 20
        current = client.get(f"/api/events/{child['id']}", headers=manager).json()
        undone = client.post(
            f"/api/events/{child['id']}/unmerge",
            headers=manager,
            json={"relationship_version": current["relationship_version"], "reason": "隔离撤销"},
        )
        assert undone.status_code == 200, undone.text
        assert snapshot(second)["summary"]["guardian_value"] == 0
        assert [r["delta"] for r in second.get("/api/visitor/me/rewards").json()["items"]] == [
            -20,
            20,
        ]
        act(client, child["id"], manager, "assign", assignee="单独处理组")
        assert snapshot(second)["summary"]["guardian_value"] == 20


def test_same_account_two_distinct_contributions_to_one_case_reward_once(client):
    """Grouping two formerly independent cases cannot retain two awards for one account."""
    client.app.state.ai = ProofProvider()
    root, token = create_submission(client, "green")
    proof(client, root, token)
    manager = admin(client)
    act(client, root["id"], manager, "assign", assignee="隔离组")
    child, token = create_submission(client, "blue")
    analyzed = proof(client, child, token)
    candidate = client.get(f"/api/events/{child['id']}/associations", headers=manager).json()[
        "candidates"
    ][0]
    merged = client.post(
        f"/api/events/{child['id']}/merge",
        headers=manager,
        json={
            "target_event_id": root["id"],
            "source_revision": analyzed["revision"],
            "target_revision": candidate["version"],
            "reason": "隔离关联",
        },
    )
    assert merged.status_code == 200
    review(client, manager, child["id"], "accepted")
    assert snapshot(client)["summary"]["guardian_value"] == 20
    assert snapshot(client)["summary"]["valid_contribution_count"] == 1


def test_deliberate_legacy_import_bad_tokens_bound_accounts_and_restart(client, settings):
    """Historical capability reads survive, but explicit imports cannot steal bound records."""
    card = memory(client)
    identifier = card["postcard"]["id"]
    claim = {"id": identifier, "kind": "memory", "query_token": card["query_token"]}
    with client.app.state.db.transaction() as conn:
        conn.execute("UPDATE postcards SET owner_id=NULL,legacy_access=1 WHERE id=?", (identifier,))
        conn.execute("UPDATE uploads SET owner_id=NULL,access_mode='legacy'")
    assert (
        client.get(
            f"/api/postcards/{identifier}",
            headers={"Cookie": "", "X-Visitor-Token": claim["query_token"]},
        ).status_code
        == 200
    )
    other = TestClient(client.app)
    account(other)
    invalid = {**claim, "query_token": "wrong"}
    assert (
        other.post("/api/visitor/me/import", json={"records": [invalid]}).json()[0]["imported"]
        is False
    )
    assert (
        other.post("/api/visitor/me/import", json={"records": [claim]}).json()[0]["imported"]
        is True
    )
    assert (
        client.post("/api/visitor/me/import", json={"records": [claim]}).json()[0]["imported"]
        is False
    )
    assert (
        other.post("/api/visitor/me/import", json={"records": [claim]}).json()[0]["imported"]
        is True
    )
    assert snapshot(other)["summary"]["guardian_value"] == 10
    with TestClient(create_app(settings)) as restarted:
        account(restarted, register=False)
        assert snapshot(restarted)["summary"]["guardian_value"] == 10
        assert restarted.get(f"/api/postcards/{identifier}").status_code == 200


def test_v2_upgrade_retains_legacy_records_and_backs_up_before_migration(tmp_path):
    """Inspect the backup itself and the upgraded ownership default, not just the version flag."""
    path = tmp_path / "events.sqlite3"
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
        conn.executescript(UPGRADE)
        conn.execute(
            "INSERT INTO postcards VALUES(?,?,?,?,?,?)",
            ("a" * 32, "old-token-digest", "qinling-demo", "原匿名记忆", "[]", now()),
        )
    db = Database(tmp_path)
    db.initialize()
    db.initialize()
    backups = list((tmp_path / "backups").glob("before-v3-*.sqlite3"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as backup:
        assert backup.execute("PRAGMA user_version").fetchone()[0] == 2
        assert backup.execute("SELECT description FROM postcards").fetchone()[0] == "原匿名记忆"
    with db.connect() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 3
        row = conn.execute("SELECT * FROM postcards").fetchone()
        assert row["owner_id"] is None and row["legacy_access"] == 1


@pytest.mark.parametrize("note", ["", "  "])
def test_contribution_review_requires_nonblank_note_and_fresh_revision(client, note):
    """Administrator confirmation needs an actual reason and cannot race a stale event revision."""
    event, _ = report(client)
    manager = admin(client)
    response = client.post(
        f"/api/events/{event['id']}/contribution",
        headers=manager,
        json={"decision": "accepted", "note": note, "revision": event["revision"]},
    )
    assert response.status_code == 422
    response = client.post(
        f"/api/events/{event['id']}/contribution",
        headers=manager,
        json={"decision": "accepted", "note": "旧版本", "revision": event["revision"] + 1},
    )
    assert response.status_code == 409

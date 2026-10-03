"""Verify destination filters before pagination and root-only pending counters, without AI."""

from backend.tests.test_api import act, admin, upload


def submission(client, scenic="terracotta-demo", point="terracotta-entry"):
    """Save a real upload and explicitly labeled isolated test submission."""
    response = client.post(
        "/api/events",
        json={
            "scenic_id": scenic,
            "point_id": point,
            "description": "景区筛选离线测试材料，非真实事件",
            "original_images": [upload(client)],
            "is_demo": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["event"]


def test_scenic_filter_before_pagination(client):
    """Another destination must not consume the filtered page or affect its total."""
    manager = admin(client)
    expected = [submission(client, "huashan-demo", "huashan-entry")["id"] for _ in range(3)]
    for _ in range(21):
        submission(client)
    first = client.get("/api/events?scenic_id=huashan-demo&limit=1", headers=manager).json()
    second = client.get(
        "/api/events?scenic_id=huashan-demo&limit=1&offset=1", headers=manager
    ).json()
    assert first["total"] == second["total"] == 3
    assert first["items"][0]["id"] in expected
    assert second["items"][0]["id"] in expected
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert all(e["scenic_id"] == "huashan-demo" for e in first["items"] + second["items"])


def test_scenic_point_and_status_intersection(client):
    """Point and processing stage compose with destination rather than overriding it."""
    manager = admin(client)
    entrance = submission(client)
    rest = submission(client, point="terracotta-rest")
    submission(client, "huashan-demo", "huashan-rest")
    assert act(client, rest["id"], manager, "assign", assignee="测试保洁组").status_code == 200
    page = client.get(
        "/api/events?scenic_id=terracotta-demo&point_id=terracotta-rest&status=processing",
        headers=manager,
    ).json()
    assert page["total"] == 1
    assert page["items"][0]["id"] == rest["id"]
    mismatched = client.get(
        "/api/events?scenic_id=huashan-demo&point_id=terracotta-entry", headers=manager
    ).json()
    assert mismatched["total"] == 0 and mismatched["items"] == []
    unknown = client.get("/api/events?scenic_id=unknown", headers=manager).json()
    assert unknown["total"] == 0
    assert entrance["scenic_id"] == "terracotta-demo"


def test_scenic_filter_requires_admin(client):
    """Adding destination filtering must not make the administrator queue public."""
    event = submission(client)
    assert client.get("/api/events?scenic_id=terracotta-demo").status_code == 401
    page = client.get("/api/events", headers=admin(client)).json()
    assert page["total"] == 1 and page["items"][0]["id"] == event["id"]


def test_pending_counts_exclude_finished_and_merged_submissions(client):
    """Count four open stages as roots; closed, rejected and linked copies are not pending."""
    events = [submission(client) for _ in range(7)]
    statuses = [
        "pending_review",
        "needs_info",
        "processing",
        "pending_acceptance",
        "closed",
        "rejected",
    ]
    with client.app.state.db.transaction() as conn:
        for event, status in zip(events[:6], statuses, strict=True):
            conn.execute("UPDATE events SET status=? WHERE id=?", (status, event["id"]))
        conn.execute(
            "UPDATE events SET merged_into=? WHERE id=?", (events[0]["id"], events[-1]["id"])
        )
    summary = client.get("/api/overview").json()
    point = next(p for p in summary["points"] if p["id"] == "terracotta-entry")
    assert point["event_count"] == 6 and point["pending_count"] == 4
    assert summary["total"] == 6 and summary["submission_count"] == 7
    assert all(p["pending_count"] == 0 for p in summary["points"] if p["id"] != point["id"])
    page = client.get("/api/events?scenic_id=terracotta-demo", headers=admin(client)).json()
    assert page["total"] == 6
    assert events[-1]["id"] not in [e["id"] for e in page["items"]]

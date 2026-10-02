from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import create_app


def admin(client):
    response = client.post(
        "/api/auth/login",
        json={
            "username": "admin",
            "password": "test-password-for-demo",
        },
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def upload(client, color="green"):
    buffer = BytesIO()
    Image.new("RGB", (16, 16), color).save(buffer, format="PNG")
    response = client.post(
        "/api/uploads", files={"file": ("photo.png", buffer.getvalue(), "image/png")}
    )
    assert response.status_code == 201, response.text
    return response.json()


def report(client):
    picture = upload(client)
    response = client.post(
        "/api/events",
        json={
            "scenic_id": "qinling-demo",
            "point_id": "trail-entrance",
            "description": "步道入口发现散落垃圾",
            "original_images": [picture],
            "is_demo": True,
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    return body["event"], {"X-Visitor-Token": body["query_token"]}


def act(client, event_id, headers, action, **fields):
    return client.post(
        f"/api/events/{event_id}/actions", headers=headers, json={"action": action, **fields}
    )


def test_full_lifecycle_and_persistence(client, settings):
    event, visitor = report(client)
    manager = admin(client)
    assert event["status"] == "pending_review"
    assert act(client, event["id"], manager, "close", note="跳过审核").status_code == 409
    response = act(client, event["id"], manager, "assign", assignee="保洁组张师傅", note="请处理")
    assert response.json()["status"] == "processing"
    picture = upload(client, "blue")
    response = act(
        client,
        event["id"],
        manager,
        "submit_resolution",
        resolution_images=[picture],
        note="已完成清理",
    )
    assert response.json()["status"] == "pending_acceptance"
    response = act(client, event["id"], manager, "close", note="人工核验通过，感谢参与")
    assert response.json()["status"] == "closed"
    with TestClient(create_app(settings)) as restarted:
        saved = restarted.get(f"/api/events/{event['id']}", headers=visitor).json()
        assert saved["status"] == "closed"
        assert saved["review_note"] == "人工核验通过，感谢参与"
        assert len(saved["timeline"]) == 4
        assert restarted.get(saved["original_images"][0]["url"]).status_code == 200
        assert restarted.get(saved["resolution_images"][0]["url"]).status_code == 200


def test_credentials_are_event_scoped_and_admin_actions_protected(client):
    one, token = report(client)
    two, _ = report(client)
    assert client.get(f"/api/events/{one['id']}").status_code == 401
    assert client.get(f"/api/events/{two['id']}", headers=token).status_code == 403
    assert client.get("/api/events", headers=token).status_code == 401
    for action in ["assign", "close", "reject", "return", "submit_resolution", "request_info"]:
        assert act(client, one["id"], token, action, note="越权").status_code == 401
    assert "query_token" not in client.get(f"/api/events/{one['id']}", headers=token).text


def test_supplement_return_and_reject(client):
    event, visitor = report(client)
    manager = admin(client)
    assert act(client, event["id"], visitor, "supplement", description="信息").status_code == 409
    assert (
        act(client, event["id"], manager, "request_info", note="请补充具体位置").json()["status"]
        == "needs_info"
    )
    assert (
        act(client, event["id"], visitor, "supplement", description="入口右侧垃圾桶旁").json()[
            "status"
        ]
        == "pending_review"
    )
    act(client, event["id"], manager, "assign", assignee="保洁组")
    assert (
        act(client, event["id"], manager, "submit_resolution", note="没有照片").status_code == 422
    )
    act(
        client,
        event["id"],
        manager,
        "submit_resolution",
        note="已清理",
        resolution_images=[upload(client)],
    )
    assert (
        act(client, event["id"], manager, "return", note="仍有垃圾").json()["status"]
        == "processing"
    )
    act(
        client,
        event["id"],
        manager,
        "submit_resolution",
        note="再次清理",
        resolution_images=[upload(client, "red")],
    )
    assert act(client, event["id"], manager, "close", note="通过").status_code == 200
    other, _ = report(client)
    assert (
        act(client, other["id"], manager, "reject", note="无关材料").json()["status"] == "rejected"
    )
    assert act(client, other["id"], manager, "assign", assignee="保洁组").status_code == 409


def test_upload_validation_claims_and_real_counts(client):
    assert (
        client.post(
            "/api/uploads", files={"file": ("x.png", b"not-image", "image/png")}
        ).status_code
        == 415
    )
    pic = upload(client)
    assert upload(client)["duplicate_hint"] is True
    payload = {"scenic_id": "qinling-demo", "point_id": "trail-entrance", "original_images": [pic]}
    bad = {**payload, "original_images": [{"id": pic["id"], "upload_token": "wrong"}]}
    assert client.post("/api/events", json=bad).status_code == 403
    assert client.post("/api/events", json={**payload, "point_id": "planned"}).status_code == 422
    assert client.post("/api/events", json=payload).status_code == 201
    assert client.post("/api/events", json=payload).status_code == 409
    overview = client.get("/api/overview").json()
    assert overview["total"] == 1
    assert overview["by_status"]["pending_review"] == 1
    assert overview["points"][0]["event_count"] == 1
    assert (
        client.get("/api/events", headers=admin(client), params={"status": "closed"}).json()[
            "total"
        ]
        == 0
    )


def test_ai_unavailable_keeps_materials_and_allows_manual_work(client):
    event, visitor = report(client)

    class Unavailable:
        async def analyze_report(self, **kwargs):
            raise RuntimeError("service down")

    client.app.state.ai = Unavailable()
    response = client.post(
        f"/api/events/{event['id']}/analysis", headers=visitor, json={"kind": "report"}
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "ai_failed"
    saved = client.get(f"/api/events/{event['id']}", headers=visitor).json()
    assert saved["status"] == "pending_review"
    assert saved["ai_status"]["report"] == "failed"
    assert len(saved["original_images"]) == 1
    assert saved["analyses"][0]["error"]["retryable"] is True
    assert (
        act(client, event["id"], admin(client), "assign", assignee="人工处理组").status_code == 200
    )


def test_login_logout_errors_do_not_leak_inputs(client):
    response = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert response.status_code == 401
    manager = admin(client)
    assert client.post("/api/auth/logout", headers=manager).status_code == 204
    assert client.get("/api/events", headers=manager).status_code == 401
    response = client.post("/api/auth/login", json={"username": "admin", "password": ["secret"]})
    assert response.status_code == 422
    assert "secret" not in response.text
    assert "error" in response.json()


def test_openapi_exposes_credentials_for_interactive_integration(client):
    schema = client.get("/openapi.json").json()
    assert "AdminSession" in schema["components"]["securitySchemes"]
    visitor_scheme = schema["components"]["securitySchemes"]["VisitorToken"]
    assert visitor_scheme["name"] == "X-Visitor-Token"
    operation = schema["paths"]["/api/events/{event_id}"]["get"]
    assert {"AdminSession": []} in operation["security"]
    assert {"VisitorToken": []} in operation["security"]


def test_failed_create_rolls_back_image_claim_and_large_upload_is_rejected(client):
    picture = upload(client)
    response = client.post(
        "/api/events",
        json={
            "scenic_id": "qinling-demo",
            "point_id": "trail-entrance",
            "original_images": [picture, picture],
        },
    )
    assert response.status_code == 409
    assert (
        client.post(
            "/api/events",
            json={
                "scenic_id": "qinling-demo",
                "point_id": "trail-entrance",
                "original_images": [picture],
            },
        ).status_code
        == 201
    )
    client.app.state.settings.max_upload_bytes = 2
    assert (
        client.post("/api/uploads", files={"file": ("big.jpg", b"123", "image/jpeg")}).status_code
        == 413
    )

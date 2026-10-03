import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.tests.test_api import act, admin, report, upload, visitor_login


def report_output(**changes):
    return {
        "title": "测试替身：步道垃圾",
        "summary": "仅用于契约测试，不是模型输出",
        "category": "litter",
        "visible_observations": ["测试可见现象"],
        "missing_information": [],
        "follow_up_questions": [],
        "recommendations": ["人工复核"],
        "suggested_department": "保洁组",
        **changes,
    }


class TestProvider:
    __test__ = False

    def __init__(self, result=None, error=None):
        self.result = result or report_output()
        self.error = error
        self.received = None

    async def analyze_report(self, **kwargs):
        self.received = kwargs
        if self.error:
            raise self.error
        return self.result

    async def review_resolution(self, **kwargs):
        self.received = kwargs
        return {
            "visible_changes": ["测试替身：垃圾减少"],
            "remaining_issues": [],
            "uncertainties": ["测试数据"],
            "acceptance_recommendation": "请人工现场验收",
        }


def test_retry_versions_and_resolution_never_auto_close(client):
    event, visitor = report(client)
    provider = TestProvider(error=RuntimeError("secret-api-key"))
    client.app.state.ai = provider
    url = f"/api/events/{event['id']}/analysis"
    failed = client.post(url, headers=visitor, json={"kind": "report"})
    assert failed.status_code == 502
    assert "secret-api-key" not in failed.text
    provider.error = None
    response = client.post(url, headers=visitor, json={"kind": "report"})
    assert response.status_code == 200
    assert [a["version"] for a in response.json()["analyses"]] == [1, 2]
    assert response.json()["status"] == "pending_review"
    assert provider.received["photos"][0].is_file()
    manager = admin(client)
    act(client, event["id"], manager, "assign", assignee="清理组")
    act(
        client,
        event["id"],
        manager,
        "submit_resolution",
        note="已清理",
        resolution_images=[upload(client, "blue")],
    )
    assert client.post(url, headers=visitor, json={"kind": "resolution"}).status_code == 401
    response = client.post(url, headers=manager, json={"kind": "resolution"})
    assert response.status_code == 200
    assert response.json()["status"] == "pending_acceptance"
    assert response.json()["ai_status"]["resolution"] == "succeeded"
    assert response.json()["ai_status"]["report"] == "succeeded"
    assert response.json()["analyses"][1]["stale"] is False
    assert provider.received["resolution_photos"][0].is_file()
    assert provider.received["resolution_note"] == "已清理"
    assert client.get("/api/overview").json()["total"] == 1


def test_missing_information_and_invalid_output(client):
    event, visitor = report(client)
    client.app.state.ai = TestProvider(result=report_output(missing_information=["请补充现场位置"]))
    url = f"/api/events/{event['id']}/analysis"
    response = client.post(url, headers=visitor, json={"kind": "report"})
    assert response.json()["status"] == "needs_info"
    act(client, event["id"], visitor, "supplement", description="步道入口")
    client.app.state.ai = TestProvider(result={"bad": "secret"})
    assert client.post(url, headers=visitor, json={"kind": "report"}).status_code == 502
    saved = client.get(f"/api/events/{event['id']}", headers=visitor).json()
    assert saved["analyses"][0]["stale"] is True
    assert saved["analyses"][1]["error"]["code"] == "ai_invalid_output"
    assert saved["status"] == "pending_review"


def test_timeout_is_persisted_and_retryable(client):
    class SlowProvider(TestProvider):
        async def analyze_report(self, **kwargs):
            await asyncio.sleep(0.2)
            return report_output()

    client.app.state.settings.ai_timeout_seconds = 0.01
    client.app.state.ai = SlowProvider()
    event, visitor = report(client)
    response = client.post(
        f"/api/events/{event['id']}/analysis", headers=visitor, json={"kind": "report"}
    )
    assert response.status_code == 504
    saved = client.get(f"/api/events/{event['id']}", headers=visitor).json()
    assert saved["ai_status"]["report"] == "failed"
    assert saved["analyses"][0]["error"]["retryable"] is True


@pytest.mark.parametrize("change_materials", [False, True])
def test_concurrent_analysis_and_late_results_respect_human_changes(client, change_materials):
    entered, release = threading.Event(), threading.Event()

    class BlockingProvider(TestProvider):
        async def analyze_report(self, **kwargs):
            entered.set()
            for _ in range(1000):
                if release.is_set():
                    return report_output(missing_information=["测试追问"])
                await asyncio.sleep(0.01)
            raise TimeoutError()

    client.app.state.ai = BlockingProvider()
    event, visitor = report(client)
    manager = admin(client)
    url = f"/api/events/{event['id']}/analysis"
    with ThreadPoolExecutor() as pool:
        pending = pool.submit(client.post, url, headers=visitor, json={"kind": "report"})
        try:
            assert entered.wait(5)
            assert client.post(url, headers=visitor, json={"kind": "report"}).status_code == 409
            if change_materials:
                act(client, event["id"], manager, "request_info", note="人工补充要求")
                act(client, event["id"], visitor, "supplement", description="新材料")
            else:
                act(client, event["id"], manager, "assign", assignee="人工派单")
        finally:
            release.set()
        assert pending.result(5).status_code == 200
    saved = client.get(f"/api/events/{event['id']}", headers=visitor).json()
    assert saved["status"] == ("pending_review" if change_materials else "processing")
    assert saved["analyses"][0]["stale"] is change_materials


def test_interrupted_analysis_recovers_on_restart(client, settings):  # noqa: F811
    event, visitor = report(client)
    client.post(f"/api/events/{event['id']}/analysis", headers=visitor, json={"kind": "report"})
    with client.app.state.db.transaction() as conn:
        conn.execute("UPDATE analyses SET status='running',error=NULL,finished_at=NULL")
    with TestClient(create_app(settings, ai=TestProvider())) as restarted:
        visitor_login(restarted)
        saved = restarted.get(f"/api/events/{event['id']}", headers=visitor).json()
        assert saved["analyses"][0]["error"]["code"] == "ai_interrupted"
        retry = restarted.post(
            f"/api/events/{event['id']}/analysis", headers=visitor, json={"kind": "report"}
        )
        assert retry.status_code == 200


def test_frontend_static_fallback_and_api_errors(client, settings):  # noqa: F811
    dist = settings.data_dir / "test-dist"
    dist.mkdir()
    (dist / "index.html").write_text("<h1>Integration test</h1>", encoding="utf-8")
    settings.frontend_dist = dist
    assert client.get("/events/visitor-page").text == "<h1>Integration test</h1>"
    assert client.get("/api/does-not-exist").status_code == 404
    assert client.get("/assets/missing.js").status_code == 404
    assert client.get("/.env").status_code == 404
    assert client.get("/api/health").json()["frontend_built"] is True

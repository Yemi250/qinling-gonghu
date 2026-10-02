"""离线测试：用 httpx 桩模拟模型响应，验证结构校验与失败恢复。运行：python -m pytest tests_ai -q"""
import json

import httpx

from backend.app.ai import ImageInput, analyze_report, review_resolution
from backend.app.ai.config import AIConfig

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def cfg(tmp_path, key="k", retries=0):
    return AIConfig(api_key=key, base_url="http://x/v1", model="m", timeout_s=1,
                    max_retries=retries, log_path=str(tmp_path / "log.jsonl"))


def stub(monkeypatch, content=None, exc=None, status=200):
    def fake_post(url, json=None, headers=None, timeout=None):
        if exc:
            raise exc
        return httpx.Response(status, json={"choices": [{"message": {"content": content}}]},
                              request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "post", fake_post)


GOOD = json.dumps({"verdict": "ok", "category": "垃圾散落", "title": "步道旁垃圾散落",
                   "summary": "s", "visible_observations": ["地面有塑料瓶"],
                   "suggested_action": "清运", "suggested_department": "保洁队"},
                  ensure_ascii=False)


def test_ok(monkeypatch, tmp_path):
    stub(monkeypatch, GOOD)
    r = analyze_report(ImageInput(data=PNG), "步道1", "有垃圾", cfg(tmp_path))
    assert r.status == "success" and r.report.category.value == "垃圾散落"


def test_ok_without_evidence_is_downgraded(monkeypatch, tmp_path):
    d = json.loads(GOOD)
    d["visible_observations"] = []
    stub(monkeypatch, json.dumps(d, ensure_ascii=False))
    r = analyze_report(ImageInput(data=PNG), cfg=cfg(tmp_path))
    assert r.report.verdict == "uncertain"


def test_fenced_json_is_accepted(monkeypatch, tmp_path):
    stub(monkeypatch, "```json\n" + GOOD + "\n```")
    assert analyze_report(ImageInput(data=PNG), cfg=cfg(tmp_path)).status == "success"


def test_garbage_output_fails_not_fakes(monkeypatch, tmp_path):
    stub(monkeypatch, "我看不清")
    r = analyze_report(ImageInput(data=PNG), cfg=cfg(tmp_path))
    assert r.status == "failed" and r.error_code == "invalid_output" and r.report is None


def test_bad_category_fails(monkeypatch, tmp_path):
    bad = {"verdict": "ok", "category": "山火", "title": "t", "summary": "s"}
    stub(monkeypatch, json.dumps(bad))
    assert analyze_report(ImageInput(data=PNG), cfg=cfg(tmp_path)).error_code == "invalid_output"


def test_timeout(monkeypatch, tmp_path):
    stub(monkeypatch, exc=httpx.ReadTimeout("t"))
    assert analyze_report(ImageInput(data=PNG), cfg=cfg(tmp_path)).error_code == "timeout"


def test_no_key(tmp_path):
    assert analyze_report(ImageInput(data=PNG), cfg=cfg(tmp_path, key="")).error_code == "auth"


def test_non_image(tmp_path):
    r = analyze_report(ImageInput(data=b"hello"), cfg=cfg(tmp_path))
    assert r.error_code == "bad_image"


def test_review(monkeypatch, tmp_path):
    stub(monkeypatch, json.dumps({"suggestion": "need_human", "cannot_confirm": ["视角不同"]},
                                 ensure_ascii=False))
    r = review_resolution(ImageInput(data=PNG), ImageInput(data=PNG), cfg=cfg(tmp_path))
    assert r.status == "success" and r.review.suggestion == "need_human"


def test_review_bad_suggestion(monkeypatch, tmp_path):
    stub(monkeypatch, json.dumps({"suggestion": "pass"}))
    r = review_resolution(ImageInput(data=PNG), ImageInput(data=PNG), cfg=cfg(tmp_path))
    assert r.error_code == "invalid_output"

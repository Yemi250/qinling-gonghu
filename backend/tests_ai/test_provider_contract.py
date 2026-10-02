"""适配层测试：验证内核结果到 C 契约（ReportResult / ResolutionResult）的映射。"""
import asyncio
import json

import httpx
import pytest

from backend.app.ai import provider


class Cfg:
    base_url = "http://x/v1"
    model = "m"
    api_key = "k"
    timeout_seconds = 5


def stub(monkeypatch, payload, status=200):
    def fake_post(url, json=None, headers=None, timeout=None):
        return httpx.Response(status, json={"choices": [{"message": {"content": payload}}]},
                              request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "post", fake_post)


def run(coro):
    return asyncio.run(coro)


def test_report_maps_to_contract(monkeypatch):
    stub(monkeypatch, json.dumps({
        "verdict": "ok", "category": "垃圾堆积", "title": "垃圾桶旁垃圾堆积",
        "summary": "可见多处袋装垃圾堆放。", "visible_observations": ["袋装垃圾堆放"],
        "missing_info": [], "follow_up_questions": [], "suggested_action": "安排清运",
        "suggested_department": "保洁队", "caveats": ["无法确认堆放时间"]}, ensure_ascii=False))
    r = run(provider.analyze_report(photos=[], point={"name": "步道1"},
                                    description="有垃圾", config=Cfg()))
    assert r.category == "waste_pile"
    assert r.recommendations == ["安排清运", "无法确认堆放时间"]
    assert r.suggested_department == "保洁队"


def test_verdict_overrides_category(monkeypatch):
    stub(monkeypatch, json.dumps({
        "verdict": "unrelated", "category": "垃圾散落", "title": "t", "summary": "s",
        "visible_observations": ["一个人"]}, ensure_ascii=False))
    r = run(provider.analyze_report(photos=[], point={}, description="", config=Cfg()))
    assert r.category == "unrelated"


def test_empty_fields_fall_back(monkeypatch):
    stub(monkeypatch, json.dumps({"verdict": "uncertain", "category": "无法确定",
                                  "title": "", "summary": ""}, ensure_ascii=False))
    r = run(provider.analyze_report(photos=[], point={}, description="", config=Cfg()))
    assert r.title and r.summary and r.category == "uncertain"


def test_resolution_maps_to_contract(monkeypatch):
    stub(monkeypatch, json.dumps({
        "suggestion": "need_human", "visible_changes": ["垃圾已清走"],
        "remaining_issues": [], "cannot_confirm": ["视角不同"], "summary": "难以直接对比"},
        ensure_ascii=False))
    r = run(provider.review_resolution(original_photos=[], resolution_photos=[],
                                       resolution_note="", config=Cfg()))
    assert r.uncertainties == ["视角不同"]
    assert r.acceptance_recommendation == "难以直接对比"


def test_invalid_structure_propagates(monkeypatch):
    stub(monkeypatch, "不是 JSON")
    with pytest.raises(Exception):
        run(provider.analyze_report(photos=[], point={}, description="", config=Cfg()))


def test_timeout_maps_to_timeout_error(monkeypatch):
    """C 依赖 TimeoutError 记 ai_timeout，不能漏成 ai_failed。"""
    def fake_post(url, json=None, headers=None, timeout=None):
        raise httpx.ReadTimeout("t")
    monkeypatch.setattr(httpx, "post", fake_post)
    with pytest.raises(TimeoutError):
        run(provider.analyze_report(photos=[], point={}, description="", config=Cfg()))


def test_bad_json_maps_to_validation_error(monkeypatch):
    """C 依赖 ValidationError 记 ai_invalid_output。"""
    from pydantic import ValidationError
    stub(monkeypatch, "我看不清")
    with pytest.raises(ValidationError):
        run(provider.analyze_report(photos=[], point={}, description="", config=Cfg()))


def test_ok_without_evidence_downgraded_in_provider(monkeypatch):
    """provider 也必须走归一化：无可见依据的 ok 要降级，不能直接派单。"""
    stub(monkeypatch, json.dumps({
        "verdict": "ok", "category": "垃圾散落", "title": "t", "summary": "s",
        "visible_observations": []}, ensure_ascii=False))
    r = run(provider.analyze_report(photos=[], point={}, description="", config=Cfg()))
    assert r.category == "uncertain"


def test_long_title_is_truncated(monkeypatch):
    stub(monkeypatch, json.dumps({
        "verdict": "ok", "category": "垃圾散落", "title": "很长的标题" * 20, "summary": "s",
        "visible_observations": ["有垃圾"]}, ensure_ascii=False))
    r = run(provider.analyze_report(photos=[], point={}, description="", config=Cfg()))
    assert len(r.title) <= 40

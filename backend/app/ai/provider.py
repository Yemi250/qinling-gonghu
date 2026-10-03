"""D 的对外适配层：把同步内核暴露为 C 需要的异步接口（backend.app.ai.provider）。

约定见 docs/AI_INTEGRATION.md：不访问数据库、不改工单、不派单。模型由 config.model 决定。
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from ..models import ReportResult, ResolutionResult
from . import prompts
from .client import AIError, chat_json
from .config import AIConfig as CoreConfig
from .schemas import ImageInput, ReportAnalysis, ResolutionReview, Verdict
from .service import _as_list, _normalize_report

_CATEGORY_MAP = {
    "垃圾散落": "litter",
    "垃圾堆积": "waste_pile",
    "垃圾桶满溢": "overflowing_bin",
    "疑似烟雾": "suspected_smoke",
    "疑似火点": "suspected_fire",
    "水体外观异常": "water_appearance",
    "无明显问题": "no_obvious_issue",
    "无关图片": "unrelated",
    "无法确定": "uncertain",
}

_POINT_ID_FALLBACK = {
    "litter": "景区环境线索",
    "waste_pile": "景区环境线索",
    "overflowing_bin": "景区环境线索",
    "suspected_smoke": "环境异常线索",
    "suspected_fire": "环境异常线索",
    "water_appearance": "环境异常线索",
    "no_obvious_issue": "未见明显问题",
    "unrelated": "与景区环境问题无关",
    "uncertain": "需人工确认的线索",
}


def _cfg(config: Any, op: str) -> CoreConfig:
    """把 C 的 AIConfig 转成内核配置。密钥只在此处使用，不写日志、不入库。"""
    return CoreConfig(
        api_key=config.api_key,
        base_url=config.base_url.rstrip("/"),
        model=config.model,
        timeout_s=float(config.timeout_seconds),
        max_retries=1,
        log_path=getattr(config, "log_path", "data/ai_calls.jsonl"),
    )


async def _call(cfg: CoreConfig, system: str, user_text: str, images: list, op: str) -> dict:
    """在线程中调用模型，并按 C 的异常约定转换：超时抛 TimeoutError，坏输出抛 ValidationError。"""
    try:
        data, _ = await asyncio.to_thread(chat_json, cfg, system, user_text, images, op)
        return data
    except AIError as e:
        if e.code == "timeout":
            raise TimeoutError(e.message) from None
        if e.code == "invalid_output":
            ReportResult.model_validate({})  # 抛 pydantic.ValidationError，C 记为 ai_invalid_output
        raise


def _clean(items: list[str], limit: int = 20) -> list[str]:
    return [s.strip() for s in items if s and s.strip()][:limit]


def _text(value: str, fallback: str) -> str:
    value = (value or "").strip()
    return (value or fallback)[:4000]


def _to_report(rep: ReportAnalysis) -> ReportResult:
    """把内核结果转成 C 的 ReportResult；verdict 优先决定最终类别。"""
    category = _CATEGORY_MAP[rep.category.value]
    if rep.verdict == Verdict.unrelated:
        category = "unrelated"
    elif rep.verdict == Verdict.no_issue:
        category = "no_obvious_issue"
    elif rep.verdict == Verdict.uncertain:
        category = "uncertain"
    return ReportResult(
        title=_text(rep.title, _POINT_ID_FALLBACK[category]),
        summary=_text(rep.summary, "AI 未能给出摘要，请人工查看图片。"),
        category=category,
        visible_observations=_clean(rep.visible_observations),
        missing_information=_clean(rep.missing_info),
        follow_up_questions=_clean(rep.follow_up_questions, 2),
        recommendations=_clean([rep.suggested_action] + rep.caveats),
        suggested_department=(rep.suggested_department or "").strip()[:200],
    )


def _to_resolution(rv: ResolutionReview) -> ResolutionResult:
    return ResolutionResult(
        visible_changes=_clean(rv.visible_changes),
        remaining_issues=_clean(rv.remaining_issues),
        uncertainties=_clean(rv.cannot_confirm),
        acceptance_recommendation=_text(rv.summary, "无法自动对比，请人工验收。"),
    )


async def analyze_report(
    *, photos: list[Path], point: dict, description: str, config: Any
) -> ReportResult:
    """分析已保存的上报照片。"""
    cfg = _cfg(config, "analyze_report")
    images = [ImageInput(path=str(p)) for p in photos]
    data = await _call(
        cfg, prompts.SYSTEM_REPORT,
        prompts.report_user_text(point.get("name", ""), description), images, "analyze_report",
    )
    return _to_report(_normalize_report(data))


async def review_resolution(
    *,
    original_photos: list[Path],
    resolution_photos: list[Path],
    resolution_note: str,
    config: Any,
) -> ResolutionResult:
    """对比整改前后照片，给出人工验收参考。"""
    cfg = _cfg(config, "review_resolution")
    before = [ImageInput(path=str(p)) for p in original_photos]
    after = [ImageInput(path=str(p)) for p in resolution_photos]
    data = await _call(
        cfg, prompts.SYSTEM_REVIEW,
        prompts.review_user_text("", resolution_note, len(before), len(after)),
        before + after, "review_resolution",
    )
    data = dict(data)
    for k in ("visible_changes", "remaining_issues", "cannot_confirm"):
        data[k] = _as_list(data.get(k))
    return _to_resolution(ResolutionReview.model_validate(data))

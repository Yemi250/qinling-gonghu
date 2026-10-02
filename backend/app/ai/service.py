"""D 模块对外入口：analyze_report / review_resolution。只返回结果，不改库、不派单。"""
from __future__ import annotations

from typing import List, Optional, Union

from pydantic import ValidationError

from . import prompts
from .client import AIError, chat_json
from .config import AIConfig, load_config
from .schemas import (AnalysisResult, AnalysisStatus, ImageInput,
                      ReportAnalysis, ResolutionReview, Verdict)

_REVIEW_OK = {"recommend_accept", "recommend_reject", "need_human"}
_LIST_FIELDS = ("visible_observations", "missing_info", "follow_up_questions", "caveats")


def _fail(cfg: AIConfig, e: AIError) -> AnalysisResult:
    return AnalysisResult(status=AnalysisStatus.failed, model=cfg.model,
                          error_code=e.code, error_message=e.message)


def _as_list(v) -> list:
    if not v:
        return []
    return [str(x) for x in v] if isinstance(v, list) else [str(v)]


def _normalize_report(d: dict) -> ReportAnalysis:
    """容错归一化；ok 但无可见依据时降级为 uncertain，不强行编成确定事件。"""
    d = dict(d)
    d["title"] = str(d.get("title", ""))[:40]
    for k in _LIST_FIELDS:
        d[k] = _as_list(d.get(k))
    d["follow_up_questions"] = d["follow_up_questions"][:2]
    rep = ReportAnalysis.model_validate(d)
    if rep.verdict == Verdict.ok and not rep.visible_observations:
        rep.verdict = Verdict.uncertain
        rep.caveats.append("模型未给出可见依据，已降级为需人工确认")
    if rep.verdict in (Verdict.unrelated, Verdict.no_issue):
        rep.follow_up_questions = []
    return rep


def _as_images(x: Union[ImageInput, List[ImageInput]]) -> List[ImageInput]:
    return list(x) if isinstance(x, (list, tuple)) else [x]


def analyze_report(image: Union[ImageInput, List[ImageInput]], spot: str = "",
                   description: str = "", cfg: Optional[AIConfig] = None) -> AnalysisResult:
    """分析游客上报照片（一张或多张）。"""
    cfg = cfg or load_config()
    images = _as_images(image)
    try:
        data, ms = chat_json(cfg, prompts.SYSTEM_REPORT,
                             prompts.report_user_text(spot, description), images, "analyze_report")
        try:
            rep = _normalize_report(data)
        except (ValidationError, ValueError, TypeError):
            raise AIError("invalid_output", "模型输出不符合约定结构")
        return AnalysisResult(status=AnalysisStatus.success, model=cfg.model,
                              latency_ms=ms, report=rep)
    except AIError as e:
        return _fail(cfg, e)


def review_resolution(before: Union[ImageInput, List[ImageInput]],
                      after: Union[ImageInput, List[ImageInput]], spot: str = "", note: str = "",
                      cfg: Optional[AIConfig] = None) -> AnalysisResult:
    """对比整改前后照片（各一张或多张），给出人工验收建议。"""
    cfg = cfg or load_config()
    b, a = _as_images(before), _as_images(after)
    try:
        data, ms = chat_json(cfg, prompts.SYSTEM_REVIEW,
                             prompts.review_user_text(spot, note, len(b), len(a)),
                             b + a, "review_resolution")
        try:
            data = dict(data)
            for k in ("visible_changes", "remaining_issues", "cannot_confirm"):
                data[k] = _as_list(data.get(k))
            rv = ResolutionReview.model_validate(data)
            if rv.suggestion not in _REVIEW_OK:
                raise ValueError("bad suggestion")
        except (ValidationError, ValueError, TypeError):
            raise AIError("invalid_output", "模型输出不符合约定结构")
        return AnalysisResult(status=AnalysisStatus.success, model=cfg.model,
                              latency_ms=ms, review=rv)
    except AIError as e:
        return _fail(cfg, e)

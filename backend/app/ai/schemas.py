"""D 模块的输入输出契约（pydantic）。C 直接 import 使用。"""
from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class Category(StrEnum):
    litter_scatter = "垃圾散落"
    litter_pile = "垃圾堆积"
    bin_overflow = "垃圾桶满溢"
    smoke = "疑似烟雾"
    fire = "疑似火点"
    water = "水体外观异常"
    no_issue = "无明显问题"
    unrelated = "无关图片"
    uncertain = "无法确定"


class Verdict(StrEnum):
    ok = "ok"  # 可据此派单
    need_info = "need_info"  # 需要游客补充
    no_issue = "no_issue"  # 未见明显问题
    unrelated = "unrelated"  # 与任务无关
    uncertain = "uncertain"  # 证据不足，转人工


class AnalysisStatus(StrEnum):
    success = "success"
    failed = "failed"


class ImageInput(BaseModel):
    """图片二选一：本地文件路径或原始字节。"""
    path: str | None = None
    data: bytes | None = None


class ReportAnalysis(BaseModel):
    verdict: Verdict
    category: Category
    title: str = Field(max_length=40)
    summary: str
    visible_observations: list[str] = Field(default_factory=list)
    missing_info: list[str] = Field(default_factory=list)
    follow_up_questions: list[str] = Field(default_factory=list)
    suggested_action: str = ""
    suggested_department: str = ""
    caveats: list[str] = Field(default_factory=list)  # 无法确认之处


class ResolutionReview(BaseModel):
    suggestion: str  # recommend_accept / recommend_reject / need_human
    visible_changes: list[str] = Field(default_factory=list)
    remaining_issues: list[str] = Field(default_factory=list)
    cannot_confirm: list[str] = Field(default_factory=list)
    summary: str = ""


class AnalysisResult(BaseModel):
    """C 调用的统一返回：失败不抛给业务层，也不伪造成功。"""
    status: AnalysisStatus
    model: str = ""
    latency_ms: int = 0
    # timeout / invalid_output / auth / network / bad_image / rate_limit
    error_code: str | None = None
    error_message: str | None = None
    report: ReportAnalysis | None = None
    review: ResolutionReview | None = None

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
Identifier = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{32}$")]


class Status(StrEnum):
    needs_info = "needs_info"
    pending_review = "pending_review"
    processing = "processing"
    pending_acceptance = "pending_acceptance"
    closed = "closed"
    rejected = "rejected"


class AIState(StrEnum):
    not_started = "not_started"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class ImageClaim(BaseModel):
    # Upload responses can be passed back directly; public metadata is ignored.
    id: Identifier
    upload_token: str = Field(min_length=1, max_length=200)


class ImageView(BaseModel):
    id: str
    url: str
    content_type: str
    size: int


class UploadResponse(ImageView):
    upload_token: str
    duplicate_hint: bool


class CreateEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    scenic_id: str
    point_id: str
    description: str = Field(default="", max_length=4000)
    original_images: list[ImageClaim] = Field(min_length=1, max_length=5)
    is_demo: bool = False


class Action(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    action: Literal[
        "request_info", "supplement", "assign", "submit_resolution", "close", "return", "reject"
    ]
    note: str = Field(default="", max_length=4000)
    assignee: str = Field(default="", max_length=100)
    description: str = Field(default="", max_length=4000)
    original_images: list[ImageClaim] = Field(default_factory=list, max_length=5)
    resolution_images: list[ImageClaim] = Field(default_factory=list, max_length=5)


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["report", "resolution"]


class ReportResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Text
    summary: Text
    category: Literal[
        "litter",
        "waste_pile",
        "overflowing_bin",
        "suspected_smoke",
        "suspected_fire",
        "water_appearance",
        "no_obvious_issue",
        "unrelated",
        "uncertain",
    ]
    visible_observations: list[Text] = Field(max_length=20)
    missing_information: list[Text] = Field(max_length=20)
    follow_up_questions: list[Text] = Field(max_length=20)
    recommendations: list[Text] = Field(max_length=20)
    suggested_department: str = Field(max_length=200)


class ResolutionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    visible_changes: list[Text] = Field(max_length=20)
    remaining_issues: list[Text] = Field(max_length=20)
    uncertainties: list[Text] = Field(max_length=20)
    acceptance_recommendation: Text


class ErrorInfo(BaseModel):
    code: str
    message: str
    retryable: bool = False
    details: list[dict] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    error: ErrorInfo


class AnalysisView(BaseModel):
    id: str
    version: int
    kind: Literal["report", "resolution"]
    material_version: int
    status: AIState
    model: str
    started_at: str
    finished_at: str | None
    stale: bool
    input_snapshot: dict
    result: ReportResult | ResolutionResult | None
    error: ErrorInfo | None


class TimelineEntry(BaseModel):
    id: int
    action: str
    actor: Literal["visitor", "admin", "ai", "system"]
    note: str
    from_status: Status | None
    to_status: Status
    created_at: str
    evidence: dict


class Event(BaseModel):
    id: str
    scenic_id: str
    point_id: str
    description: str
    original_images: list[ImageView]
    status: Status
    assignee: str | None
    resolution_images: list[ImageView]
    resolution_note: str
    review_note: str
    is_demo: bool
    material_version: int
    created_at: str
    updated_at: str
    timeline: list[TimelineEntry]
    analyses: list[AnalysisView]
    ai_status: dict[Literal["report", "resolution"], AIState]


class CreatedEvent(BaseModel):
    event: Event
    query_token: str


class CreatePostcard(BaseModel):
    """A private scenic memory, independent from environmental work orders."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    scenic_id: Literal[
        "terracotta-demo",
        "qinling-demo",
        "huashan-demo",
        "baotashan-demo",
        "hanzhong-demo",
        "zhenbeitai-demo",
    ]
    description: str = Field(default="", max_length=4000)
    images: list[ImageClaim] = Field(min_length=1, max_length=1)


class Postcard(BaseModel):
    """Public fields of a memory; its access credential is never echoed."""

    id: str
    scenic_id: str
    description: str
    images: list[ImageView]
    created_at: str


class CreatedPostcard(BaseModel):
    """Return the query credential once, when a memory is created."""

    postcard: Postcard
    query_token: str


class EventList(BaseModel):
    items: list[Event]
    total: int
    limit: int
    offset: int


class Login(BaseModel):
    username: str = Field(max_length=100)
    password: str = Field(max_length=200)


class Session(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: str


class Point(BaseModel):
    id: str
    scenic_id: str
    name: str
    availability: Literal["demo", "planned"]
    label: str
    event_count: int = 0


class Overview(BaseModel):
    total: int
    today_count: int
    closed_count: int
    demo_count: int
    by_status: dict[Status, int]
    points: list[Point]

"""Typed visitor identity, passport, private records and reward contracts."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class VisitorLogin(BaseModel):
    username: str = Field(pattern=r"^[a-zA-Z0-9_]{3,32}$")
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value):
        """Treat username case consistently without altering passwords."""
        return value.strip().lower() if isinstance(value, str) else value


class Register(VisitorLogin):
    confirm_password: str = Field(min_length=8, max_length=128)
    nickname: str = Field(default="", max_length=24)


class VisitorUser(BaseModel):
    id: str
    username: str
    nickname: str
    created_at: str


class VisitorSession(BaseModel):
    user: VisitorUser | None
    csrf_token: str | None = None


class Summary(BaseModel):
    explored_count: int
    memory_count: int
    valid_contribution_count: int
    closed_case_count: int
    guardian_value: int


class Badge(BaseModel):
    id: str
    name: str
    condition: str
    target: int
    progress: int
    earned: bool
    earned_at: str | None


class Task(BaseModel):
    key: Literal["explore", "memory", "care"]
    label: str
    state: Literal["idle", "running", "completed"]


class ScenicProgress(BaseModel):
    scenic_id: str
    name: str
    explored: bool
    tasks: list[Task]


class Passport(BaseModel):
    summary: Summary
    badges: list[Badge]
    scenes: list[ScenicProgress]


class PersonalRecord(BaseModel):
    id: str
    kind: Literal["memory", "care"]
    scenic_id: str
    title: str
    image: str
    created_at: str
    status: str | None = None


class PersonalRecords(BaseModel):
    items: list[PersonalRecord]
    total: int
    limit: int
    offset: int


class RewardChange(BaseModel):
    id: int
    label: str
    delta: int
    note: str
    created_at: str


class RewardHistory(BaseModel):
    items: list[RewardChange]
    total: int
    limit: int
    offset: int


class LegacyClaim(BaseModel):
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    kind: Literal["memory", "care"]
    query_token: str = Field(min_length=1, max_length=200)


class ImportRecords(BaseModel):
    records: list[LegacyClaim] = Field(min_length=1, max_length=50)


class ImportResult(BaseModel):
    id: str
    kind: Literal["memory", "care"]
    imported: bool
    message: str


class ContributionDecision(BaseModel):
    decision: Literal["accepted", "rejected"]
    note: str = Field(min_length=1, max_length=4000)
    revision: int = Field(ge=1)

    @field_validator("note", mode="before")
    @classmethod
    def meaningful_note(cls, value):
        """Strip whitespace before validating a mandatory administrator review reason."""
        return value.strip() if isinstance(value, str) else value


class ContributionStatus(BaseModel):
    decision: Literal["pending", "accepted", "rejected"]
    independent: bool
    valid: bool
    account_record: bool
    note: str

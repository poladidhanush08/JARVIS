from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator, model_validator

from jarvis.fingerprint import fingerprint


def to_utc(dt: datetime) -> datetime:
    """Naive values are taken as UTC; aware values are converted to UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


class Metric(BaseModel):
    name: str
    value: float


class Event(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    timestamp: datetime
    source: Literal["api", "log_file", "simulator"] = "api"
    service: str
    type: Literal["log", "alert", "metric", "deploy"] = "log"
    level: Literal["debug", "info", "warn", "error", "critical"] = "info"
    message: str
    fingerprint: str = ""
    metric: Metric | None = None
    trace_id: str | None = None
    tags: dict[str, str] = Field(default_factory=dict)

    @field_validator("timestamp")
    @classmethod
    def _timestamp_utc(cls, v: datetime) -> datetime:
        return to_utc(v)

    @model_validator(mode="after")
    def _fill_fingerprint(self) -> "Event":
        if not self.fingerprint:
            self.fingerprint = fingerprint(self.message)
        return self

    @property
    def is_anomalous(self) -> bool:
        return self.level in {"warn", "error", "critical"} or self.type == "alert"


class RootCauseCandidate(BaseModel):
    service: str
    cause_type: str
    confidence: int = Field(ge=0, le=99)
    factors: dict[str, float] = Field(default_factory=dict)  # keys: first, graph, change, own
    evidence: list[str] = Field(default_factory=list)


class Recommendation(BaseModel):
    step: int
    action: str
    effect: str
    command: str | None = None
    verify: str


class Impact(BaseModel):
    users_affected: int = 0
    failed_transactions: int = 0
    endpoints: list[str] = Field(default_factory=list)
    services: list[str] = Field(default_factory=list)
    minutes_since_start: int = 0


class KeyMoment(BaseModel):
    timestamp: datetime
    service: str
    label: str
    event_id: str


class Incident(BaseModel):
    id: str  # e.g. INC-001
    title: str = ""
    status: Literal["open", "investigating", "resolved"] = "investigating"
    severity: Literal["SEV1", "SEV2", "SEV3", "SEV4"] = "SEV4"
    start_time: datetime
    last_event_time: datetime
    event_ids: list[str] = Field(default_factory=list)
    affected_services: list[str] = Field(default_factory=list)
    promoted: bool = False
    root_cause_candidates: list[RootCauseCandidate] = Field(default_factory=list)
    impact: Impact = Field(default_factory=Impact)
    recommendations: list[Recommendation] = Field(default_factory=list)
    key_moments: list[KeyMoment] = Field(default_factory=list)
    correlation_reasons: dict[str, list[str]] = Field(default_factory=dict)
    runner_up_note: str = ""
    cause_phrase: str = ""
    updated_at: datetime | None = None  # wall clock (UTC) of the last enrichment

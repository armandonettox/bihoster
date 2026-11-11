from typing import Any, Optional

from pydantic import BaseModel

from app.schemas.types import UtcDatetime


class AILogEntryOut(BaseModel):
    id: int
    created_at: UtcDatetime
    user_email: Optional[str]
    conversation_id: Optional[int]
    provider: str
    model: str
    report_name: Optional[str]
    outcome: str
    error: Optional[str]
    duration_ms: int
    llm_calls: int
    input_tokens: int
    output_tokens: int
    used_image: bool
    question: Optional[str]
    reply: Optional[str]
    dax: Optional[str]
    steps: list[dict[str, Any]]


class AILogModelStats(BaseModel):
    provider: str
    model: str
    questions: int
    problems: int
    avg_ms: int
    p95_ms: int


class AILogOut(BaseModel):
    days: int
    retention_days: int
    entries: list[AILogEntryOut]
    next_before_id: Optional[int]
    by_model: list[AILogModelStats]

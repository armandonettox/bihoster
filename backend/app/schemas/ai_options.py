from typing import Optional

from pydantic import BaseModel, Field

from app.core.ai_options import (
    DEFAULT_DAILY_QUESTION_LIMIT,
    DEFAULT_RETENTION_DAYS,
    MAX_DAILY_QUESTION_LIMIT,
    MAX_MONTHLY_BUDGET_USD,
    MAX_RETENTION_DAYS,
    MIN_RETENTION_DAYS,
)


class AIOptionsOut(BaseModel):
    retention_days: int
    default_retention_days: int = DEFAULT_RETENTION_DAYS
    # Perguntas por pessoa por dia; 0 = sem limite
    daily_question_limit: int
    default_daily_question_limit: int = DEFAULT_DAILY_QUESTION_LIMIT
    # Dolares por mes so do OpenRouter; None = sem orcamento
    openrouter_monthly_budget_usd: Optional[float]


class AIOptionsUpdate(BaseModel):
    # None = manter o valor atual
    retention_days: Optional[int] = Field(default=None, ge=MIN_RETENTION_DAYS, le=MAX_RETENTION_DAYS)
    daily_question_limit: Optional[int] = Field(default=None, ge=0, le=MAX_DAILY_QUESTION_LIMIT)
    # 0 tira o orcamento
    openrouter_monthly_budget_usd: Optional[float] = Field(default=None, ge=0, le=MAX_MONTHLY_BUDGET_USD)

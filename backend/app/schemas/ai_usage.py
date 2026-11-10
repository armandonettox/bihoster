from typing import Optional

from pydantic import BaseModel


class UsageTotalsOut(BaseModel):
    questions: int
    input_tokens: int
    output_tokens: int
    cost_usd: float  # soma do que tem preco conhecido (so OpenRouter)
    unpriced_questions: int  # perguntas do OpenRouter cujo modelo nao tem preco na lista


class UsageByUserOut(UsageTotalsOut):
    user_id: Optional[int]  # nulo quando a conta foi excluida
    email: Optional[str]


class UsageByModelOut(UsageTotalsOut):
    provider: str
    model: str


class OpenRouterBudgetOut(BaseModel):
    monthly_usd: Optional[float]
    spent_month_usd: float
    remaining_usd: Optional[float]
    blocked: bool
    unpriced_questions_month: int


class UsageOut(BaseModel):
    period_days: int
    totals: UsageTotalsOut
    by_user: list[UsageByUserOut]
    by_model: list[UsageByModelOut]
    daily_limit: int
    openrouter_budget: OpenRouterBudgetOut

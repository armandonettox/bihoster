"""Consumo do chat de IA: registra cada pergunta respondida, aplica o limite de perguntas por pessoa
por dia e o orcamento mensal do OpenRouter, e resume o consumo para o admin.

"Dia" e "mes" seguem o fuso configurado do sistema (Configuracoes > Geral), nao o do servidor."""

from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import and_, case, func
from sqlalchemy.orm import Session

from app.core import ai_options
from app.models.ai_usage import AIUsage

OPENROUTER = "openrouter"


class LimitReached(Exception):
    """Limite de perguntas ou orcamento atingido. Mensagem segura para mostrar ao usuario."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _zone(db: Session):
    name = ai_options.get_settings_row(db).timezone
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return timezone.utc


def day_start_utc(db: Session, now: Optional[datetime] = None) -> datetime:
    """Meia-noite de hoje no fuso do sistema, em UTC."""
    local = (now or _now()).astimezone(_zone(db))
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def month_start_utc(db: Session, now: Optional[datetime] = None) -> datetime:
    """Meia-noite do dia 1 do mes atual no fuso do sistema, em UTC."""
    local = (now or _now()).astimezone(_zone(db))
    return local.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def questions_since(db: Session, user_id: int, since: datetime) -> int:
    return db.query(AIUsage).filter(AIUsage.user_id == user_id, AIUsage.created_at >= since).count()


def openrouter_spent_since(db: Session, since: datetime) -> float:
    total = (
        db.query(func.coalesce(func.sum(AIUsage.cost_usd), 0.0))
        .filter(AIUsage.provider == OPENROUTER, AIUsage.created_at >= since)
        .scalar()
    )
    return float(total or 0.0)


def check_limits(db: Session, user_id: int, provider: str) -> None:
    """Levanta LimitReached se a pessoa ja usou as perguntas do dia ou, quando o chat usa o OpenRouter,
    se o orcamento do mes acabou."""
    limit = ai_options.daily_question_limit(db)
    if limit > 0 and questions_since(db, user_id, day_start_utc(db)) >= limit:
        raise LimitReached(f"Voce atingiu o limite de {limit} perguntas por dia. Tente novamente amanha.")

    if provider == OPENROUTER:
        budget = ai_options.openrouter_monthly_budget(db)
        if budget is not None and openrouter_spent_since(db, month_start_utc(db)) >= budget:
            raise LimitReached(
                "O orcamento mensal do OpenRouter foi atingido. Peca a um administrador para ajustar o limite."
            )


def record(db: Session, user, answer, cost_usd: Optional[float]) -> None:
    """Registra a pergunta respondida. `answer` e um chat_engine.ChatAnswer; `user` e o usuario logado."""
    db.add(
        AIUsage(
            created_at=_now(),
            user_id=user.id,
            user_email=user.email,
            provider=answer.provider,
            model=answer.model,
            report_id=answer.report.id if answer.report else None,
            llm_calls=answer.llm_calls,
            input_tokens=answer.input_tokens,
            output_tokens=answer.output_tokens,
            cost_usd=cost_usd,
        )
    )
    db.commit()


def _unpriced():
    """Pergunta do OpenRouter que ficou sem custo (modelo fora da lista de precos)."""
    return case((and_(AIUsage.provider == OPENROUTER, AIUsage.cost_usd.is_(None)), 1), else_=0)


def _aggregate(db: Session, since: datetime, *group_columns) -> list:
    query = db.query(
        *group_columns,
        func.count(AIUsage.id),
        func.coalesce(func.sum(AIUsage.input_tokens), 0),
        func.coalesce(func.sum(AIUsage.output_tokens), 0),
        func.coalesce(func.sum(AIUsage.cost_usd), 0.0),
        func.coalesce(func.sum(_unpriced()), 0),
    ).filter(AIUsage.created_at >= since)
    if group_columns:
        query = query.group_by(*group_columns)
    return query.all()


def summarize(db: Session, days: int) -> dict:
    """Consumo dos ultimos `days` dias, por pessoa e por provedor e modelo, mais a situacao do mes."""
    since = _now() - timedelta(days=days)

    by_user = sorted(
        (
            {
                "user_id": user_id,
                "email": email,
                "questions": questions,
                "input_tokens": int(tokens_in),
                "output_tokens": int(tokens_out),
                "cost_usd": round(float(cost), 6),
                "unpriced_questions": int(unpriced),
            }
            for user_id, email, questions, tokens_in, tokens_out, cost, unpriced in _aggregate(
                db, since, AIUsage.user_id, AIUsage.user_email
            )
        ),
        key=lambda row: (-row["questions"], row["email"] or ""),
    )
    by_model = sorted(
        (
            {
                "provider": provider,
                "model": model,
                "questions": questions,
                "input_tokens": int(tokens_in),
                "output_tokens": int(tokens_out),
                "cost_usd": round(float(cost), 6),
                "unpriced_questions": int(unpriced),
            }
            for provider, model, questions, tokens_in, tokens_out, cost, unpriced in _aggregate(
                db, since, AIUsage.provider, AIUsage.model
            )
        ),
        key=lambda row: (-row["questions"], row["provider"], row["model"]),
    )
    ((total_questions, total_in, total_out, total_cost, total_unpriced),) = _aggregate(db, since)

    month_start = month_start_utc(db)
    budget = ai_options.openrouter_monthly_budget(db)
    spent = openrouter_spent_since(db, month_start)
    unpriced_month = (
        db.query(func.count(AIUsage.id))
        .filter(AIUsage.provider == OPENROUTER, AIUsage.cost_usd.is_(None), AIUsage.created_at >= month_start)
        .scalar()
    )
    return {
        "period_days": days,
        "totals": {
            "questions": total_questions,
            "input_tokens": int(total_in),
            "output_tokens": int(total_out),
            "cost_usd": round(float(total_cost), 6),
            "unpriced_questions": int(total_unpriced),
        },
        "by_user": by_user,
        "by_model": by_model,
        "daily_limit": ai_options.daily_question_limit(db),
        "openrouter_budget": {
            "monthly_usd": budget,
            "spent_month_usd": round(spent, 6),
            "remaining_usd": None if budget is None else round(max(budget - spent, 0.0), 6),
            "blocked": budget is not None and spent >= budget,
            "unpriced_questions_month": int(unpriced_month or 0),
        },
    }

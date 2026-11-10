"""Opcoes do chat de IA que o admin ajusta em Configuracoes > IA. Ficam na linha unica de
AppSettings; coluna nula vale o padrao."""

from typing import Optional

from sqlalchemy.orm import Session

from app.models.settings import AppSettings

DEFAULT_RETENTION_DAYS = 30
MIN_RETENTION_DAYS = 1
MAX_RETENTION_DAYS = 3650
DEFAULT_DAILY_QUESTION_LIMIT = 50
MAX_DAILY_QUESTION_LIMIT = 100000
MAX_MONTHLY_BUDGET_USD = 1_000_000.0


def get_settings_row(db: Session) -> AppSettings:
    row = db.query(AppSettings).filter(AppSettings.id == 1).first()
    if not row:
        row = AppSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def retention_days(db: Session) -> int:
    """Dias que uma conversa parada fica guardada antes de ser apagada."""
    value = get_settings_row(db).ai_retention_days
    return value if value else DEFAULT_RETENTION_DAYS


def daily_question_limit(db: Session) -> int:
    """Perguntas por pessoa por dia. 0 quer dizer sem limite; nao configurado vale o padrao."""
    value = get_settings_row(db).ai_daily_question_limit
    return DEFAULT_DAILY_QUESTION_LIMIT if value is None else value


def openrouter_monthly_budget(db: Session) -> Optional[float]:
    """Orcamento mensal do OpenRouter em dolares, ou None quando nao ha orcamento."""
    value = get_settings_row(db).ai_openrouter_monthly_budget
    return value if value and value > 0 else None

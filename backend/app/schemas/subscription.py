from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.core import subscription_schedule as sched
from app.core.email_sender import MAX_RECIPIENTS
from app.schemas.types import UtcDatetime

SubscriptionFormat = Literal["PDF", "PNG"]


def _one_line(value: Optional[str]) -> Optional[str]:
    """Texto de uma linha so, sem quebras: vira cabecalho de e-mail."""
    if value is None:
        return None
    return " ".join(value.split()) or None


def _check(func, *args):
    """Traduz o erro de horario do modulo de regras pra um erro de validacao do pydantic."""
    try:
        return func(*args)
    except sched.ScheduleError as exc:
        raise ValueError(str(exc)) from None


class _SubscriptionFields(BaseModel):
    """Regras comuns a criar e a editar (na edicao todos os campos sao opcionais)."""

    @field_validator("recipients", check_fields=False)
    @classmethod
    def normalize_recipients(cls, value):
        if value is None:
            return value
        unique = list(dict.fromkeys(str(email).strip().lower() for email in value))
        if not unique:
            raise ValueError("Informe pelo menos um destinatario.")
        if len(unique) > MAX_RECIPIENTS:
            raise ValueError(f"No maximo {MAX_RECIPIENTS} destinatarios por assinatura.")
        return unique

    @field_validator("days", check_fields=False)
    @classmethod
    def valid_days(cls, value):
        return None if value is None else _check(sched.normalize_days, value)

    @field_validator("times", check_fields=False)
    @classmethod
    def valid_times(cls, value):
        return None if value is None else _check(sched.normalize_times, value)

    @field_validator("timezone", check_fields=False)
    @classmethod
    def valid_timezone(cls, value):
        return None if value is None else _check(sched.validate_timezone, value)

    @field_validator("name", "subject", check_fields=False)
    @classmethod
    def one_line(cls, value):
        return _one_line(value)

    @field_validator("message", check_fields=False)
    @classmethod
    def clean_message(cls, value):
        return value.strip() or None if value is not None else None

    @model_validator(mode="after")
    def valid_period(self):
        _check(sched.validate_period, getattr(self, "start_date", None), getattr(self, "end_date", None))
        return self


class SubscriptionCreate(_SubscriptionFields):
    name: Optional[str] = Field(default=None, max_length=120)
    recipients: list[EmailStr] = Field(min_length=1)
    format: SubscriptionFormat = "PDF"
    days: list[int]
    times: list[str]
    timezone: Optional[str] = None  # sem isso, usa o fuso das Configuracoes
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    subject: Optional[str] = Field(default=None, max_length=150)
    message: Optional[str] = Field(default=None, max_length=1000)
    enabled: bool = True
    # Paginas a incluir. Vazio/null = todas as do relatorio
    page_names: Optional[list[str]] = None


class SubscriptionUpdate(_SubscriptionFields):
    name: Optional[str] = Field(default=None, max_length=120)
    recipients: Optional[list[EmailStr]] = None
    format: Optional[SubscriptionFormat] = None
    days: Optional[list[int]] = None
    times: Optional[list[str]] = None
    timezone: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    subject: Optional[str] = Field(default=None, max_length=150)
    message: Optional[str] = Field(default=None, max_length=1000)
    enabled: Optional[bool] = None
    page_names: Optional[list[str]] = None

    @model_validator(mode="after")
    def not_null_when_sent(self):
        # Campo obrigatorio nao pode ser apagado mandando null explicito
        for field in ("recipients", "format", "days", "times", "timezone", "enabled"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"O campo '{field}' nao pode ser nulo")
        return self


class SubscriptionOut(BaseModel):
    id: int
    report_id: int
    report_name: str
    collection_id: int
    collection_name: Optional[str] = None
    name: Optional[str]
    recipients: list[str]
    format: str
    days: list[int]
    times: list[str]
    schedule_text: str
    timezone: str
    start_date: Optional[date]
    end_date: Optional[date]
    subject: Optional[str]
    message: Optional[str]
    page_names: list[str]
    enabled: bool
    next_run_at: Optional[UtcDatetime]
    last_run_at: Optional[UtcDatetime]
    last_status: Optional[str]
    last_message: Optional[str]
    consecutive_failures: int
    created_by_name: Optional[str]
    created_at: Optional[UtcDatetime]


class SubscriptionRunOut(BaseModel):
    id: int
    started_at: UtcDatetime
    finished_at: Optional[UtcDatetime]
    status: str
    trigger: str
    attempts: int
    message: Optional[str]
    recipients_count: int


class RunNowOut(BaseModel):
    job_id: str

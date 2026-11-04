"""Regra de horarios das assinaturas: dias da semana, horarios do dia, fuso e periodo de validade.

Sao funcoes puras (sem banco nem relogio proprio): quem chama passa o instante de referencia, o que
deixa tudo testavel. Todos os instantes de entrada e saida sao UTC; os dias e horarios da assinatura
valem no FUSO da assinatura (ex: America/Sao_Paulo), que e quem manda em "toda segunda as 08:00"."""

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
MAX_TIMES_PER_DAY = 6
# Segunda = 0 ... domingo = 6, o mesmo de datetime.weekday()
WEEKDAY_NAMES = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"]


class ScheduleError(ValueError):
    """Entrada de horario invalida (mensagem segura para mostrar ao usuario)."""


def normalize_days(days: Sequence[int]) -> list[int]:
    """Dias da semana (0 a 6): sem repeticao, em ordem, e pelo menos um."""
    cleaned = sorted({int(d) for d in days})
    if not cleaned:
        raise ScheduleError("Escolha pelo menos um dia da semana.")
    if cleaned[0] < 0 or cleaned[-1] > 6:
        raise ScheduleError("Dia da semana invalido (use 0 para segunda ate 6 para domingo).")
    return cleaned


def normalize_times(times: Sequence[str]) -> list[str]:
    """Horarios "HH:MM": sem repeticao, em ordem, de 1 a MAX_TIMES_PER_DAY."""
    cleaned = sorted({str(t).strip() for t in times})
    if not cleaned:
        raise ScheduleError("Informe pelo menos um horario.")
    if len(cleaned) > MAX_TIMES_PER_DAY:
        raise ScheduleError(f"No maximo {MAX_TIMES_PER_DAY} horarios por dia.")
    for value in cleaned:
        if not TIME_PATTERN.match(value):
            raise ScheduleError(f"Horario invalido: '{value}'. Use o formato HH:MM, de 00:00 a 23:59.")
    return cleaned


def validate_timezone(name: str) -> str:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise ScheduleError("Fuso horario invalido.") from None
    return name


def validate_period(start_date: Optional[date], end_date: Optional[date]) -> None:
    if start_date and end_date and end_date < start_date:
        raise ScheduleError("A data final nao pode ser anterior a data inicial.")


def _as_utc(value: datetime) -> datetime:
    """O SQLite devolve datas sem fuso: tratadas como UTC, que e como sao gravadas."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def next_run_after(
    days: Sequence[int],
    times: Sequence[str],
    tz_name: str,
    after: datetime,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> Optional[datetime]:
    """O proximo horario (UTC) estritamente DEPOIS de `after`, dentro do periodo de validade.
    Devolve None quando nao ha mais nenhum (data final ja passou)."""
    tz = ZoneInfo(tz_name)
    after_utc = _as_utc(after)
    first_day = after_utc.astimezone(tz).date()
    if start_date and start_date > first_day:
        first_day = start_date

    days_set = set(days)
    parsed = sorted(tuple(int(part) for part in t.split(":")) for t in times)
    # Com ao menos um dia da semana marcado, em 8 dias seguidos sempre ha uma data que serve
    for offset in range(8):
        day = first_day + timedelta(days=offset)
        if end_date and day > end_date:
            return None
        if day.weekday() not in days_set:
            continue
        for hour, minute in parsed:
            candidate = datetime.combine(day, time(hour, minute), tzinfo=tz).astimezone(timezone.utc)
            if candidate > after_utc:
                return candidate
    return None


def describe(days: Sequence[int], times: Sequence[str]) -> str:
    """Texto curto para mostrar a recorrencia (ex: 'seg, qua, sex as 08:00, 17:30')."""
    short = {0: "seg", 1: "ter", 2: "qua", 3: "qui", 4: "sex", 5: "sab", 6: "dom"}
    if list(days) == [0, 1, 2, 3, 4, 5, 6]:
        names = "todos os dias"
    else:
        names = ", ".join(short[d] for d in days)
    return f"{names} as {', '.join(times)}"

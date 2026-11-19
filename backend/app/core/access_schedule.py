"""Horario de acesso: em que dias e horas cada grupo ou pessoa pode usar o sistema.

Regras: a pessoa com faixas proprias (excecao individual) usa so elas; senao vale a soma das faixas dos grupos dela (entra
quando qualquer uma permitir; grupo sem faixa nenhuma nao conta, senao o grupo "Todos os usuarios" anularia o limite);
sem faixa em lugar nenhum, nao ha limite. Administradores da plataforma nunca sao limitados. Os horarios valem no fuso
configurado no sistema."""

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.audit_filters import system_tz
from app.models.access_extension import STATUS_APPROVED, AccessExtensionRequest
from app.models.access_schedule import AccessScheduleRange
from app.models.user import User
from app.models.workspace import GroupMember

DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
MAX_RANGES = 20
OUTSIDE_HOURS_CODE = "outside_hours"


def _now() -> datetime:
    """O instante de agora (em UTC). Fica numa funcao para os testes fixarem o relogio."""
    return datetime.now(timezone.utc)


def now_utc() -> datetime:
    """O instante de agora, por onde passa todo o codigo que depende do relogio (os testes trocam `_now`)."""
    return _now()


def parse_days(text: str) -> set[int]:
    return {int(part) for part in (text or "").split(",") if part.strip().isdigit() and 0 <= int(part) <= 6}


def format_days(days: set[int]) -> str:
    return ",".join(str(day) for day in sorted(days))


def format_minute(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def parse_clock(text: str, *, is_end: bool) -> int:
    """Converte "HH:MM" em minutos desde a meia-noite. So o fim aceita "24:00" (o dia inteiro)."""
    try:
        hours_text, minutes_text = text.strip().split(":")
        hours, minutes = int(hours_text), int(minutes_text)
    except (ValueError, AttributeError):
        raise ValueError(f"Horario invalido: {text!r}. Use o formato HH:MM.") from None
    total = hours * 60 + minutes
    if not (0 <= minutes <= 59) or hours < 0 or total > 1440 or (total == 1440 and not is_end) or (total == 0 and is_end):
        raise ValueError(f"Horario invalido: {text!r}.")
    return total


def ranges_allow(ranges, local_dt: datetime) -> bool:
    """Diz se o instante (ja no fuso do sistema) cai dentro de alguma das faixas."""
    minute = local_dt.hour * 60 + local_dt.minute
    today = local_dt.weekday()
    yesterday = (today - 1) % 7
    for item in ranges:
        days = parse_days(item.days)
        if item.start_minute < item.end_minute:
            if today in days and item.start_minute <= minute < item.end_minute:
                return True
        else:  # vira a madrugada do dia seguinte
            if today in days and minute >= item.start_minute:
                return True
            if yesterday in days and minute < item.end_minute:
                return True
    return False


def next_open(ranges, local_dt: datetime) -> datetime | None:
    """O proximo inicio de faixa depois do instante, nos proximos 8 dias."""
    best = None
    for offset in range(8):
        day = (local_dt + timedelta(days=offset)).date()
        weekday = day.weekday()
        for item in ranges:
            if weekday not in parse_days(item.days):
                continue
            start = datetime.combine(day, time(item.start_minute // 60, item.start_minute % 60), tzinfo=local_dt.tzinfo)
            if start > local_dt and (best is None or start < best):
                best = start
    return best


def _describe_days(days: set[int]) -> str:
    if len(days) == 7:
        return "Todos os dias"
    ordered = sorted(days)
    runs, current = [], [ordered[0]]
    for day in ordered[1:]:
        if day == current[-1] + 1:
            current.append(day)
        else:
            runs.append(current)
            current = [day]
    runs.append(current)
    parts = [f"{DAY_LABELS[run[0]]} a {DAY_LABELS[run[-1]]}" if len(run) >= 3 else " e ".join(DAY_LABELS[d] for d in run) for run in runs]
    return ", ".join(parts)


def describe(ranges) -> list[str]:
    """As faixas em texto, sem repeticao: "Seg a Sex, 08:00 as 18:00"."""
    lines = []
    for item in ranges:
        days = parse_days(item.days)
        if not days:
            continue
        line = f"{_describe_days(days)}, {format_minute(item.start_minute)} às {format_minute(item.end_minute)}"
        if line not in lines:
            lines.append(line)
    return lines


@dataclass
class Decision:
    allowed: bool
    next_open: datetime | None = None
    windows: list[str] = field(default_factory=list)
    timezone_name: str = ""


def evaluate_schedule(db: Session, user: User, now: datetime | None = None) -> Decision:
    """Decide se a pessoa pode usar o sistema agora. Sem faixa nenhuma e uma consulta barata, que roda a cada pedido."""
    rows = db.query(AccessScheduleRange).filter(AccessScheduleRange.user_id == user.id).all()
    if not rows:
        rows = (
            db.query(AccessScheduleRange)
            .join(GroupMember, GroupMember.group_id == AccessScheduleRange.group_id)
            .filter(GroupMember.user_id == user.id)
            .all()
        )
    if not rows:
        return Decision(allowed=True)
    # Import aqui dentro: workspace_deps carrega o auth, que carrega este modulo (import circular)
    from app.core.workspace_deps import is_platform_admin

    if is_platform_admin(db, user.id):
        return Decision(allowed=True)

    tz, tz_name = system_tz(db)
    instant = now or _now()
    local_now = instant.astimezone(tz)
    if ranges_allow(rows, local_now):
        return Decision(allowed=True)
    # Fora das faixas, mas com uma liberacao temporaria aprovada que ainda nao venceu: pode usar ate o prazo
    release = (
        db.query(AccessExtensionRequest.id)
        .filter(
            AccessExtensionRequest.user_id == user.id,
            AccessExtensionRequest.status == STATUS_APPROVED,
            AccessExtensionRequest.grant_until > instant,
        )
        .first()
    )
    if release:
        return Decision(allowed=True)
    return Decision(allowed=False, next_open=next_open(rows, local_now), windows=describe(rows), timezone_name=tz_name)


def outside_hours_error(decision: Decision) -> HTTPException:
    """O erro de quem esta fora do horario. O detalhe e um objeto (nao um texto) para a tela mostrar o horario e a hora
    em que o acesso volta."""
    return HTTPException(
        status_code=403,
        detail={
            "code": OUTSIDE_HOURS_CODE,
            "message": "Você está fora do horário de acesso.",
            "next_open": decision.next_open.isoformat() if decision.next_open else None,
            "windows": decision.windows,
            "timezone": decision.timezone_name,
        },
    )

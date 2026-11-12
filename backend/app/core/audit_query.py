"""Consulta generica da auditoria para os visuais personalizados do painel de Analiticos.

Um visual escolhe uma MEDIDA (o que contar) e um AGRUPAMENTO (como repartir), e a consulta
respeita os mesmos filtros da tabela (periodo, pessoa, acao, recurso, colecao, relatorio).
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.audit_filters import filtered
from app.core.audit_labels import CHANGE_ACTIONS, action_label, entity_label
from app.models.audit_log import AuditLog
from app.models.user import User
from app.models.workspace import Workspace

Metric = Literal[
    "events", "people", "logins", "logins_blocked", "accounts_locked", "report_opens", "collection_visits", "changes"
]
GroupBy = Literal["none", "day", "hour", "weekday", "action", "entity", "user", "collection", "report", "login_method"]

METRIC_LABELS: dict[str, str] = {
    "events": "Eventos",
    "people": "Pessoas ativas",
    "logins": "Logins",
    "logins_blocked": "Logins bloqueados",
    "accounts_locked": "Contas travadas",
    "report_opens": "Relatorios abertos",
    "collection_visits": "Visitas a colecoes",
    "changes": "Alteracoes",
}

GROUP_LABELS: dict[str, str] = {
    "none": "Total (sem agrupar)",
    "day": "Dia",
    "hour": "Hora do dia",
    "weekday": "Dia da semana",
    "action": "Acao",
    "entity": "Recurso",
    "user": "Pessoa",
    "collection": "Colecao",
    "report": "Relatorio",
    "login_method": "Metodo de login",
}

_TIME_GROUPS = {"day", "hour", "weekday"}
_CATEGORY_GROUPS = {"action", "entity", "user", "collection", "report", "login_method", "weekday"}

# Agrupamentos que cada tipo de visual aceita
GROUPS_BY_TYPE: dict[str, set[str]] = {
    "stat": {"none"},
    "line": {"day", "hour", "weekday"},
    "bars": set(GROUP_LABELS) - {"none"},
    "donut": _CATEGORY_GROUPS,
    "table": set(GROUP_LABELS) - {"none"},
}

WEEKDAYS = ["Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado", "Domingo"]
MAX_DAYS = 366


class QueryError(ValueError):
    """Combinacao de medida e agrupamento que nao faz sentido."""


@dataclass
class Row:
    key: str
    label: str
    value: int


@dataclass
class QueryResult:
    metric: str
    metric_label: str
    group_by: str
    rows: list[Row]
    # A medida no periodo todo, sem o corte do "top N" (o centro da rosca, por exemplo)
    total: int


def _metric_conditions(metric: str) -> list:
    if metric == "logins":
        return [AuditLog.action == "login"]
    if metric == "logins_blocked":
        return [AuditLog.action == "login_blocked"]
    if metric == "accounts_locked":
        return [AuditLog.action == "account_locked"]
    if metric == "report_opens":
        return [AuditLog.action == "view_report"]
    if metric == "collection_visits":
        return [AuditLog.action == "view_collection"]
    if metric == "changes":
        return [AuditLog.action.in_(sorted(CHANGE_ACTIONS))]
    return []


def _value(metric: str):
    """Pessoas ativas conta pessoas diferentes; as demais medidas contam linhas."""
    return func.count(func.distinct(AuditLog.user_id)) if metric == "people" else func.count(AuditLog.id)


def _query(db: Session, columns: list, metric: str, filters: dict):
    query = filtered(db, db.query(*columns), **filters)
    for condition in _metric_conditions(metric):
        query = query.filter(condition)
    return query


def check_combination(metric: str, group_by: str) -> None:
    if group_by == "login_method" and metric != "logins":
        raise QueryError("O agrupamento por metodo de login so vale para a medida Logins")


def _time_rows(db, metric, group_by, filters, tz: ZoneInfo, date_from: Optional[date], date_to: Optional[date]) -> list[Row]:
    """Dia, hora e dia da semana sao contados aqui, no fuso do sistema: a data local pode ser outra que a do UTC."""
    buckets: dict[str, set | int] = {}
    distinct = metric == "people"
    for created_at, user_id in _query(db, [AuditLog.created_at, AuditLog.user_id], metric, filters).all():
        if created_at is None:
            continue
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        local = created_at.astimezone(tz)
        key = {"day": local.date().isoformat(), "hour": str(local.hour), "weekday": str(local.weekday())}[group_by]
        if distinct:
            if user_id is not None:
                buckets.setdefault(key, set()).add(user_id)  # type: ignore[union-attr]
        else:
            buckets[key] = buckets.get(key, 0) + 1  # type: ignore[operator]

    def count(key: str) -> int:
        found = buckets.get(key, 0)
        return len(found) if isinstance(found, set) else found

    if group_by == "hour":
        return [Row(str(h), f"{h}h", count(str(h))) for h in range(24)]
    if group_by == "weekday":
        return [Row(str(d), WEEKDAYS[d], count(str(d))) for d in range(7)]

    today = datetime.now(tz).date()
    first = date_from or (date.fromisoformat(min(buckets)) if buckets else today)
    last = date_to or today
    if (last - first).days >= MAX_DAYS:
        first = last - timedelta(days=MAX_DAYS - 1)
    rows = []
    cursor = first
    while cursor <= last:
        rows.append(Row(cursor.isoformat(), cursor.isoformat(), count(cursor.isoformat())))
        cursor += timedelta(days=1)
    return rows


def _category_rows(db, metric, group_by, filters, limit, include_emails: bool = True) -> list[Row]:
    value = _value(metric).label("value")
    if group_by == "action":
        rows = _query(db, [AuditLog.action, value], metric, filters).group_by(AuditLog.action)
        order = rows.order_by(value.desc()).limit(limit).all()
        return [Row(code, action_label(code), n) for code, n in order]
    if group_by == "entity":
        rows = _query(db, [AuditLog.entity, value], metric, filters).group_by(AuditLog.entity)
        order = rows.order_by(value.desc()).limit(limit).all()
        return [Row(kind, entity_label(kind), n) for kind, n in order]
    if group_by == "user":
        rows = (
            _query(db, [AuditLog.user_id, User.name, AuditLog.user_email, value], metric, filters)
            .filter(AuditLog.user_id.isnot(None))
            .group_by(AuditLog.user_id, User.name, AuditLog.user_email)
        )
        order = rows.order_by(value.desc()).limit(limit).all()
        return [Row(str(uid), name or (email if include_emails else None) or "Usuario removido", n) for uid, name, email, n in order]
    if group_by == "collection":
        rows = (
            _query(db, [AuditLog.workspace_id, Workspace.name, value], metric, filters)
            .filter(AuditLog.workspace_id.isnot(None))
            .group_by(AuditLog.workspace_id, Workspace.name)
        )
        order = rows.order_by(value.desc()).limit(limit).all()
        return [Row(str(wid), name or f"Colecao {wid}", n) for wid, name, n in order]
    if group_by == "report":
        # O nome vem do que foi gravado na acao (um relatorio apagado continua aparecendo)
        rows = (
            _query(db, [AuditLog.entity_id, func.max(AuditLog.details), value], metric, filters)
            .filter(AuditLog.entity == "report", AuditLog.entity_id.isnot(None))
            .group_by(AuditLog.entity_id)
        )
        order = rows.order_by(value.desc()).limit(limit).all()
        return [Row(rid, name or f"Relatorio {rid}", n) for rid, name, n in order]
    # login_method
    method = case((AuditLog.details == "google", "google"), else_="password").label("method")
    rows = _query(db, [method, value], metric, filters).group_by(method)
    labels = {"password": "Email e senha", "google": "Google"}
    found = {key: n for key, n in rows.all()}
    return [Row(key, labels[key], found.get(key, 0)) for key in ("password", "google")]


def run_query(
    db: Session,
    *,
    metric: str,
    group_by: str,
    limit: int,
    filters: dict,
    tz: ZoneInfo,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    include_emails: bool = True,
) -> QueryResult:
    check_combination(metric, group_by)
    total = _query(db, [_value(metric)], metric, filters).scalar() or 0

    if group_by == "none":
        rows = [Row("total", METRIC_LABELS[metric], total)]
    elif group_by in _TIME_GROUPS:
        rows = _time_rows(db, metric, group_by, filters, tz, date_from, date_to)
    else:
        rows = _category_rows(db, metric, group_by, filters, limit, include_emails)
    return QueryResult(metric=metric, metric_label=METRIC_LABELS[metric], group_by=group_by, rows=rows, total=total)

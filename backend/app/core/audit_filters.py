"""Filtros comuns da auditoria: usados pela tabela, pelo resumo e pelas consultas dos visuais."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.audit_labels import actions_matching
from app.models.audit_log import AuditLog
from app.models.settings import AppSettings
from app.models.user import User
from app.models.workspace import Workspace


def system_tz(db: Session) -> tuple[ZoneInfo, str]:
    row = db.query(AppSettings).filter(AppSettings.id == 1).first()
    name = (row.timezone if row and row.timezone else None) or "America/Sao_Paulo"
    try:
        return ZoneInfo(name), name
    except ZoneInfoNotFoundError:
        return ZoneInfo("America/Sao_Paulo"), "America/Sao_Paulo"


def utc_range(tz: ZoneInfo, date_from: date | None, date_to: date | None):
    """Dias do filtro valem no fuso do sistema; o banco guarda em UTC. date_to e inclusivo."""
    start = datetime.combine(date_from, time.min, tzinfo=tz).astimezone(timezone.utc) if date_from else None
    end = (
        datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
        if date_to
        else None
    )
    return start, end


def filtered(
    db: Session,
    query,
    *,
    q: str | None,
    action: list[str] | None,
    user_id: list[int] | None,
    workspace_id: list[int] | None,
    report_id: list[int] | None = None,
    entity: list[str] | None = None,
    start: datetime | None,
    end: datetime | None,
):
    """Aplica os filtros comuns da busca e do resumo. A busca por texto olha quem, a acao (em
    portugues ou o codigo), o recurso, a colecao e os detalhes."""
    query = query.outerjoin(User, User.id == AuditLog.user_id).outerjoin(Workspace, Workspace.id == AuditLog.workspace_id)
    # Cada filtro aceita varios valores (selecao multipla); lista vazia/ausente nao filtra
    if action:
        query = query.filter(AuditLog.action.in_(action))
    if user_id:
        query = query.filter(AuditLog.user_id.in_(user_id))
    if workspace_id:
        query = query.filter(AuditLog.workspace_id.in_(workspace_id))
    if entity:
        query = query.filter(AuditLog.entity.in_(entity))
    if report_id:
        # A auditoria guarda o id do relatorio como texto em entity_id, junto com entity="report"
        query = query.filter(AuditLog.entity == "report", AuditLog.entity_id.in_([str(r) for r in report_id]))
    if start:
        query = query.filter(AuditLog.created_at >= start)
    if end:
        query = query.filter(AuditLog.created_at < end)
    text = (q or "").strip()
    if text:
        conditions = [
            AuditLog.user_email.icontains(text, autoescape=True),
            User.name.icontains(text, autoescape=True),
            AuditLog.entity.icontains(text, autoescape=True),
            AuditLog.entity_id == text,
            AuditLog.details.icontains(text, autoescape=True),
            Workspace.name.icontains(text, autoescape=True),
        ]
        matching = actions_matching(text)
        if matching:
            conditions.append(AuditLog.action.in_(matching))
        query = query.filter(or_(*conditions))
    return query

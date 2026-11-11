from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import audit_revert
from app.core.audit import log_action
from app.core.audit_filters import filtered as _filtered
from app.core.audit_filters import system_tz as _system_tz
from app.core.audit_filters import utc_range as _utc_range
from app.core.audit_labels import action_label, entity_label
from app.core.audit_revert import parse_change, summarize
from app.core.database import get_db
from app.core.workspace_deps import require_platform_admin, require_workspace_role
from app.models.audit_log import AuditLog
from app.models.report import Report
from app.models.user import User, UserRole
from app.models.workspace import Group, GroupMember, Workspace
from app.schemas.audit_log import (
    AuditActionCount,
    AuditActionOption,
    AuditCollectionCount,
    AuditCollectionOption,
    AuditDayCount,
    AuditEntityOption,
    AuditLogOut,
    AuditLoginMethods,
    AuditOptionsOut,
    AuditPageOut,
    AuditReportCount,
    AuditReportOption,
    AuditRevertIn,
    AuditRevertOut,
    AuditSummaryOut,
    AuditTotals,
    AuditUserCount,
    AuditUserOption,
)

router = APIRouter(tags=["audit"])
workspace_router = APIRouter(prefix="/workspaces/{workspace_id}/audit", tags=["audit"])

# Acima disso o grafico por dia perde a leitura; o periodo mais antigo e cortado
MAX_DAYS_IN_CHART = 366


def _to_out(
    entry: AuditLog, user_name: str | None, workspace_name: str | None, reverted_by_name: str | None = None
) -> AuditLogOut:
    change = parse_change(entry.change)
    return AuditLogOut(
        revertible=change is not None and entry.reverted_at is None,
        revert_summary=summarize(change) if change is not None and entry.reverted_at is None else None,
        reverted_at=entry.reverted_at,
        reverted_by_name=(reverted_by_name or entry.reverted_by_email) if entry.reverted_at else None,
        id=entry.id,
        user_id=entry.user_id,
        user_name=user_name,
        user_email=entry.user_email,
        workspace_id=entry.workspace_id,
        workspace_name=workspace_name,
        action=entry.action,
        action_label=action_label(entry.action),
        entity=entry.entity,
        entity_label=entity_label(entry.entity),
        entity_id=entry.entity_id,
        details=entry.details,
        created_at=entry.created_at,
    )


@router.get("/audit", response_model=list[AuditLogOut])
def list_all_audit_logs(
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    """Visao global da auditoria -- inclui acoes sem colecao (login, registro, mudanca de
    configuracoes) que o endpoint por colecao nunca conseguiria mostrar."""
    entries = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()
    return _with_names(db, entries)


def _with_names(db: Session, entries: list[AuditLog]) -> list[AuditLogOut]:
    user_ids = {e.user_id for e in entries if e.user_id} | {e.reverted_by_id for e in entries if e.reverted_by_id}
    workspace_ids = {e.workspace_id for e in entries if e.workspace_id}
    names_by_user = dict(db.query(User.id, User.name).filter(User.id.in_(user_ids)).all()) if user_ids else {}
    names_by_workspace = (
        dict(db.query(Workspace.id, Workspace.name).filter(Workspace.id.in_(workspace_ids)).all()) if workspace_ids else {}
    )
    return [
        _to_out(
            entry,
            names_by_user.get(entry.user_id),
            names_by_workspace.get(entry.workspace_id),
            names_by_user.get(entry.reverted_by_id),
        )
        for entry in entries
    ]


@router.get("/audit/search", response_model=AuditPageOut)
def search_audit_logs(
    q: str | None = Query(None, max_length=200),
    action: list[str] | None = Query(None),
    user_id: list[int] | None = Query(None),
    workspace_id: list[int] | None = Query(None),
    report_id: list[int] | None = Query(None),
    entity: list[str] | None = Query(None),
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    """Tabela da pagina de Auditoria: busca, filtros e paginacao feitos no servidor."""
    tz, _name = _system_tz(db)
    start, end = _utc_range(tz, date_from, date_to)
    filters = dict(
        q=q,
        action=action,
        user_id=user_id,
        workspace_id=workspace_id,
        report_id=report_id,
        entity=entity,
        start=start,
        end=end,
    )

    total = _filtered(db, db.query(func.count(AuditLog.id)), **filters).scalar() or 0
    entries = (
        _filtered(db, db.query(AuditLog), **filters)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return AuditPageOut(items=_with_names(db, entries), total=total, page=page, page_size=page_size)


def _user_details(db: Session, users: list[User]) -> list[AuditUserOption]:
    """Detalhes de cada pessoa para o cartao que abre ao passar o cursor no nome. Tudo em poucas
    consultas em lote (grupos, ultimo login), nao uma por pessoa."""
    if not users:
        return []
    ids = [u.id for u in users]

    groups_by_user: dict[int, list[str]] = {}
    admin_ids: set[int] = set()
    rows = (
        db.query(GroupMember.user_id, Group.name, Group.is_admin_group, Group.is_default)
        .join(Group, Group.id == GroupMember.group_id)
        .filter(GroupMember.user_id.in_(ids))
        .order_by(Group.is_default.desc(), Group.name)
        .all()
    )
    for user_id, group_name, is_admin_group, _is_default in rows:
        groups_by_user.setdefault(user_id, []).append(group_name)
        if is_admin_group:
            admin_ids.add(user_id)

    last_login = dict(
        db.query(AuditLog.user_id, func.max(AuditLog.created_at))
        .filter(AuditLog.user_id.in_(ids), AuditLog.action == "login")
        .group_by(AuditLog.user_id)
        .all()
    )

    return [
        AuditUserOption(
            id=u.id,
            name=u.name,
            email=u.email,
            is_platform_admin=u.id in admin_ids,
            groups=groups_by_user.get(u.id, []),
            created_at=u.created_at,
            last_login_at=last_login.get(u.id),
            login_provider="google" if (u.registered_via == "google" or u.google_linked_at is not None) else "password",
            picture_url=u.picture_url,
        )
        for u in users
    ]


@router.get("/audit/options", response_model=AuditOptionsOut)
def audit_filter_options(db: Session = Depends(get_db), _=Depends(require_platform_admin)):
    """Valores para os seletores de filtro: so o que aparece de fato na auditoria."""
    codes = [code for (code,) in db.query(AuditLog.action).distinct().all()]
    actions = sorted(
        (AuditActionOption(action=code, label=action_label(code)) for code in codes), key=lambda option: option.label
    )
    kinds = [kind for (kind,) in db.query(AuditLog.entity).distinct().all()]
    entities = sorted(
        (AuditEntityOption(entity=kind, label=entity_label(kind)) for kind in kinds), key=lambda option: option.label
    )
    audited_users = db.query(AuditLog.user_id).filter(AuditLog.user_id.isnot(None)).distinct()
    users = db.query(User).filter(User.id.in_(audited_users)).order_by(User.name).all()
    people = _user_details(db, users)
    collections = db.query(Workspace.id, Workspace.name).order_by(Workspace.name).all()
    reports = (
        db.query(Report.id, Report.name, Workspace.name)
        .outerjoin(Workspace, Workspace.id == Report.collection_id)
        .order_by(Report.name)
        .all()
    )
    return AuditOptionsOut(
        actions=actions,
        entities=entities,
        users=people,
        collections=[AuditCollectionOption(id=wid, name=name) for wid, name in collections],
        reports=[AuditReportOption(id=rid, name=name, collection=collection) for rid, name, collection in reports],
    )


@router.get("/audit/summary", response_model=AuditSummaryOut)
def audit_summary(
    q: str | None = Query(None, max_length=200),
    action: list[str] | None = Query(None),
    user_id: list[int] | None = Query(None),
    workspace_id: list[int] | None = Query(None),
    report_id: list[int] | None = Query(None),
    entity: list[str] | None = Query(None),
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    """Numeros da aba Analiticos, com os mesmos filtros da tabela."""
    tz, tz_name = _system_tz(db)
    start, end = _utc_range(tz, date_from, date_to)
    filters = dict(
        q=q,
        action=action,
        user_id=user_id,
        workspace_id=workspace_id,
        report_id=report_id,
        entity=entity,
        start=start,
        end=end,
    )

    def count(*extra) -> int:
        query = _filtered(db, db.query(func.count(AuditLog.id)), **filters)
        for condition in extra:
            query = query.filter(condition)
        return query.scalar() or 0

    events = count()
    active_users = (
        _filtered(db, db.query(func.count(func.distinct(AuditLog.user_id))), **filters)
        .filter(AuditLog.user_id.isnot(None))
        .scalar()
        or 0
    )
    logins_google = count(AuditLog.action == "login", AuditLog.details == "google")
    logins_ok = count(AuditLog.action == "login")

    # Por dia e por hora no fuso do sistema: a data local pode ser outra que a do UTC
    day_counts: dict[date, int] = {}
    hour_counts = [0] * 24
    for (created_at,) in _filtered(db, db.query(AuditLog.created_at), **filters).all():
        if created_at is None:
            continue
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        local = created_at.astimezone(tz)
        day_counts[local.date()] = day_counts.get(local.date(), 0) + 1
        hour_counts[local.hour] += 1

    today = datetime.now(tz).date()
    first_day = date_from or (min(day_counts) if day_counts else today)
    last_day = date_to or today
    if (last_day - first_day).days >= MAX_DAYS_IN_CHART:
        first_day = last_day - timedelta(days=MAX_DAYS_IN_CHART - 1)
    by_day = []
    cursor = first_day
    while cursor <= last_day:
        by_day.append(AuditDayCount(date=cursor.isoformat(), count=day_counts.get(cursor, 0)))
        cursor += timedelta(days=1)

    action_rows = (
        _filtered(db, db.query(AuditLog.action, func.count(AuditLog.id)), **filters)
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc())
        .limit(8)
        .all()
    )
    user_rows = (
        _filtered(db, db.query(AuditLog.user_id, User.name, AuditLog.user_email, func.count(AuditLog.id)), **filters)
        .filter(AuditLog.user_id.isnot(None))
        .group_by(AuditLog.user_id, User.name, AuditLog.user_email)
        .order_by(func.count(AuditLog.id).desc())
        .limit(5)
        .all()
    )
    collection_rows = (
        _filtered(db, db.query(AuditLog.workspace_id, Workspace.name, func.count(AuditLog.id)), **filters)
        .filter(AuditLog.action == "view_collection", AuditLog.workspace_id.isnot(None))
        .group_by(AuditLog.workspace_id, Workspace.name)
        .order_by(func.count(AuditLog.id).desc())
        .limit(5)
        .all()
    )

    # Relatorios mais abertos: agrupa pelo id (o nome pode mudar) e usa o nome gravado na visita,
    # entao um relatorio apagado continua aparecendo com o nome que tinha
    report_rows = (
        _filtered(
            db,
            db.query(AuditLog.entity_id, func.max(AuditLog.details), func.max(Workspace.name), func.count(AuditLog.id)),
            **filters,
        )
        .filter(AuditLog.action == "view_report", AuditLog.entity_id.isnot(None))
        .group_by(AuditLog.entity_id)
        .order_by(func.count(AuditLog.id).desc())
        .limit(5)
        .all()
    )

    return AuditSummaryOut(
        totals=AuditTotals(
            events=events,
            active_users=active_users,
            logins_ok=logins_ok,
            logins_blocked=count(AuditLog.action == "login_blocked"),
            accounts_locked=count(AuditLog.action == "account_locked"),
        ),
        by_day=by_day,
        by_hour=hour_counts,
        by_action=[AuditActionCount(action=code, label=action_label(code), count=n) for code, n in action_rows],
        top_users=[
            AuditUserCount(user_id=uid, name=name or email or "Usuario removido", email=email, count=n)
            for uid, name, email, n in user_rows
        ],
        top_collections=[
            AuditCollectionCount(workspace_id=wid, name=name or f"Colecao {wid}", visits=n)
            for wid, name, n in collection_rows
        ],
        top_reports=[
            AuditReportCount(report_id=rid, name=name or f"Relatorio {rid}", collection=collection, visits=n)
            for rid, name, collection, n in report_rows
        ],
        login_methods=AuditLoginMethods(password=max(logins_ok - logins_google, 0), google=logins_google),
        timezone=tz_name,
    )


@router.post("/audit/{log_id}/revert", response_model=AuditRevertOut)
def revert_audit_action(
    log_id: int,
    data: AuditRevertIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    """Volta uma acao ao estado de antes. Se o item mudou de novo depois da acao, responde 409
    com o que esta valendo agora; a pessoa confirma e a chamada vem repetida com force=true."""
    entry = db.query(AuditLog).get(log_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Registro nao encontrado")
    change = parse_change(entry.change)
    if change is None:
        raise HTTPException(status_code=400, detail="Esta acao nao pode ser revertida")
    if entry.reverted_at is not None:
        raise HTTPException(status_code=400, detail="Esta acao ja foi revertida")

    try:
        current = audit_revert.current_state(db, entry, change)
    except audit_revert.RevertGone as exc:
        raise HTTPException(status_code=409, detail={"code": "gone", "message": f"{exc}: nao ha o que reverter."})

    expected = audit_revert.expected_state(change)
    if current != expected and not data.force:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "conflict",
                "message": "Este item foi alterado depois dessa acao.",
                "expected": audit_revert.describe_state(change, expected),
                "current": audit_revert.describe_state(change, current),
                "after_revert": audit_revert.describe_state(change, _before_state(change)),
            },
        )

    try:
        audit_revert.apply_revert(db, entry, change)
    except audit_revert.RevertGone as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "gone", "message": f"{exc}: nao ha o que reverter."})
    except audit_revert.RevertBlocked as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))

    summary = summarize(change)
    entry.reverted_at = datetime.now(timezone.utc)
    entry.reverted_by_id = current_user.id
    entry.reverted_by_email = current_user.email
    db.commit()

    if change["kind"] == audit_revert.REPORT_UPDATE:
        # O token de embed guardado pode ter sido gerado com as configuracoes de antes da reversao
        from app.routers.powerbi import invalidate_embed_cache

        invalidate_embed_cache(entry.workspace_id or 0, int(entry.entity_id or 0))

    log_action(
        db,
        action="revert",
        entity=entry.entity,
        user_id=current_user.id,
        workspace_id=entry.workspace_id,
        entity_id=entry.entity_id,
        details=f"Reverteu o registro #{entry.id}: {summary}",
    )
    return AuditRevertOut(summary=summary)


def _before_state(change: dict):
    """O "antes" no mesmo formato do estado atual (para mostrar no aviso de conflito)."""
    if change["kind"] in (audit_revert.WORKSPACE_UPDATE, audit_revert.REPORT_UPDATE):
        return {name: v["before"] for name, v in change["fields"].items()}
    return change["before"]


@workspace_router.get("/", response_model=list[AuditLogOut])
def list_audit_logs(
    workspace_id: int,
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _=Depends(require_workspace_role(UserRole.admin)),
):
    entries = (
        db.query(AuditLog)
        .filter(AuditLog.workspace_id == workspace_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    user_ids = {e.user_id for e in entries if e.user_id}
    names_by_user = dict(db.query(User.id, User.name).filter(User.id.in_(user_ids)).all()) if user_ids else {}
    return [_to_out(entry, names_by_user.get(entry.user_id), None) for entry in entries]

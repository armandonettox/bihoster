from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.workspace_deps import require_platform_admin, require_workspace_role
from app.models.audit_log import AuditLog
from app.models.user import User, UserRole
from app.models.workspace import Workspace
from app.schemas.audit_log import AuditLogOut

router = APIRouter(tags=["audit"])
workspace_router = APIRouter(prefix="/workspaces/{workspace_id}/audit", tags=["audit"])


def _to_out(entry: AuditLog, user_name: str | None, workspace_name: str | None) -> AuditLogOut:
    return AuditLogOut(
        id=entry.id,
        user_id=entry.user_id,
        user_name=user_name,
        workspace_id=entry.workspace_id,
        workspace_name=workspace_name,
        action=entry.action,
        entity=entry.entity,
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

    user_ids = {e.user_id for e in entries if e.user_id}
    workspace_ids = {e.workspace_id for e in entries if e.workspace_id}
    names_by_user = dict(db.query(User.id, User.name).filter(User.id.in_(user_ids)).all()) if user_ids else {}
    names_by_workspace = (
        dict(db.query(Workspace.id, Workspace.name).filter(Workspace.id.in_(workspace_ids)).all()) if workspace_ids else {}
    )

    return [
        _to_out(entry, names_by_user.get(entry.user_id), names_by_workspace.get(entry.workspace_id))
        for entry in entries
    ]


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

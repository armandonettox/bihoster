from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.workspace_deps import get_effective_roles_map
from app.models.audit_log import AuditLog
from app.models.report import Report
from app.models.user import User
from app.models.workspace import Workspace
from app.routers.auth import get_current_user
from app.schemas.home import HomeCollectionEntry

router = APIRouter(prefix="/home", tags=["home"])


def _to_entry(workspace: Workspace) -> HomeCollectionEntry:
    return HomeCollectionEntry(
        id=workspace.id, name=workspace.name, slug=workspace.slug, icon=workspace.icon, color=workspace.color
    )


@router.post("/collections/{workspace_id}/view", status_code=204)
def record_collection_view(
    workspace_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workspace = db.query(Workspace).get(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Colecao nao encontrada")

    roles_by_workspace = get_effective_roles_map(db, current_user.id)
    if roles_by_workspace.get(workspace_id) is None:
        raise HTTPException(status_code=403, detail="Voce nao tem acesso a essa colecao")

    log_action(db, action="view_collection", entity="workspace", user_id=current_user.id, workspace_id=workspace_id, entity_id=workspace_id)


@router.get("/recent", response_model=list[HomeCollectionEntry])
def list_recent_collections(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    logs = (
        db.query(AuditLog)
        .filter(AuditLog.user_id == current_user.id, AuditLog.action == "view_collection")
        .order_by(AuditLog.created_at.desc())
        .limit(50)
        .all()
    )

    roles_by_workspace = get_effective_roles_map(db, current_user.id)

    # Pre-carrega as colecoes candidatas numa unica query (IN) em vez de uma query por log
    # dentro do loop abaixo.
    candidate_ids = {int(entry.entity_id) for entry in logs if entry.entity_id}
    workspaces_by_id = {w.id: w for w in db.query(Workspace).filter(Workspace.id.in_(candidate_ids)).all()}

    seen: set[int] = set()
    entries: list[HomeCollectionEntry] = []
    for entry in logs:
        if not entry.entity_id:
            continue
        workspace_id = int(entry.entity_id)
        if workspace_id in seen or roles_by_workspace.get(workspace_id) is None:
            continue
        workspace = workspaces_by_id.get(workspace_id)
        if not workspace:
            continue
        seen.add(workspace_id)
        entries.append(_to_entry(workspace))
        if len(entries) >= 8:
            break

    return entries


@router.get("/recommended", response_model=list[HomeCollectionEntry])
def list_recommended_collections(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Heuristica simples: colecoes com pelo menos um relatorio, entre as que o usuario acessa."""
    workspace_ids = list(get_effective_roles_map(db, current_user.id).keys())
    if not workspace_ids:
        return []

    workspaces_with_reports = (
        db.query(Workspace)
        .join(Report, Report.collection_id == Workspace.id)
        .filter(Workspace.id.in_(workspace_ids))
        .distinct()
        .order_by(Workspace.created_at.desc())
        .limit(8)
        .all()
    )

    return [_to_entry(w) for w in workspaces_with_reports]

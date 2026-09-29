from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
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

# Janela em que reabrir a mesma colecao nao grava nova linha de auditoria
VIEW_LOG_WINDOW = timedelta(minutes=10)
# Quantas colecoes candidatas ler antes de filtrar acesso; folga pra descartar apagadas/sem acesso
RECENT_CANDIDATES = 30


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

    # Reabrir a mesma colecao em seguida nao grava outra linha: cada abertura virava uma linha
    # de auditoria (a tabela crescia sem limite e poluia a tela de auditoria). Dentro da janela
    # a visita anterior ja representa "visto recentemente".
    if not _viewed_within_window(db, current_user.id, workspace_id):
        log_action(db, action="view_collection", entity="workspace", user_id=current_user.id, workspace_id=workspace_id, entity_id=workspace_id)


def _viewed_within_window(db: Session, user_id: int, workspace_id: int) -> bool:
    last_view = (
        db.query(func.max(AuditLog.created_at))
        .filter(
            AuditLog.user_id == user_id,
            AuditLog.action == "view_collection",
            AuditLog.entity_id == str(workspace_id),
        )
        .scalar()
    )
    if last_view is None:
        return False
    # O SQLite devolve datetime sem tzinfo (sempre UTC); normaliza pra comparar sem misturar
    if last_view.tzinfo is not None:
        last_view = last_view.astimezone(timezone.utc).replace(tzinfo=None)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    return now_utc - last_view < VIEW_LOG_WINDOW


@router.get("/recent", response_model=list[HomeCollectionEntry])
def list_recent_collections(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Uma linha por colecao, com a data da visita mais recente. Antes lia as ultimas 50 linhas
    # de auditoria e deduplicava em Python: quem abria 2 ou 3 colecoes muitas vezes so via 2 ou 3
    # entradas em "Recentes", e empates no mesmo segundo ordenavam de forma imprevisivel.
    last_view = func.max(AuditLog.created_at).label("last_view")
    rows = (
        db.query(AuditLog.entity_id, last_view)
        .filter(
            AuditLog.user_id == current_user.id,
            AuditLog.action == "view_collection",
            AuditLog.entity_id.isnot(None),
        )
        .group_by(AuditLog.entity_id)
        .order_by(last_view.desc(), AuditLog.entity_id.desc())
        .limit(RECENT_CANDIDATES)
        .all()
    )

    roles_by_workspace = get_effective_roles_map(db, current_user.id)

    # Pre-carrega as colecoes candidatas numa unica query (IN) em vez de uma query por linha
    candidate_ids = {int(row.entity_id) for row in rows}
    workspaces_by_id = {w.id: w for w in db.query(Workspace).filter(Workspace.id.in_(candidate_ids)).all()}

    entries: list[HomeCollectionEntry] = []
    for row in rows:
        workspace_id = int(row.entity_id)
        workspace = workspaces_by_id.get(workspace_id)
        # Descarta colecoes apagadas ou que o usuario perdeu acesso
        if not workspace or roles_by_workspace.get(workspace_id) is None:
            continue
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

from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.search_ranking import match_tier, sort_key
from app.core.workspace_deps import get_effective_roles_map
from app.models.report import Report
from app.models.user import User
from app.models.workspace import Workspace
from app.routers.auth import get_current_user
from app.schemas.report import DisplayType

router = APIRouter(prefix="/search", tags=["search"])

MAX_RESULTS = 10

# Na mesma faixa de ranking a colecao vem antes do relatorio: e o destino mais amplo
_KIND_ORDER = {"colecao": 0, "relatorio": 1}


class SearchResultEntry(BaseModel):
    # Para kind="colecao", id e workspace_id sao o mesmo e display_type fica vazio
    id: int
    name: str
    kind: Literal["relatorio", "colecao"] = "relatorio"
    display_type: Optional[DisplayType] = None
    workspace_id: int
    workspace_name: str
    workspace_slug: str


@router.get("/", response_model=list[SearchResultEntry])
def search_reports(q: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Busca relatorios e colecoes que o usuario pode ver, ordenados por relevancia.

    O casamento ignora acento e maiuscula, o que o SQLite nao faz em ILIKE, entao os candidatos
    vem do banco so filtrados por acesso e o ranking roda em Python."""
    if not q.strip():
        return []

    roles_by_workspace = get_effective_roles_map(db, current_user.id)
    accessible_workspace_ids = list(roles_by_workspace.keys())
    if not accessible_workspace_ids:
        return []

    workspaces = db.query(Workspace).filter(Workspace.id.in_(accessible_workspace_ids)).all()
    workspaces_by_id = {w.id: w for w in workspaces}
    reports = db.query(Report).filter(Report.collection_id.in_(accessible_workspace_ids)).all()

    ranked: list[tuple[tuple, SearchResultEntry]] = []

    for workspace in workspaces:
        tier = match_tier(workspace.name, q)
        if tier is None:
            continue
        entry = SearchResultEntry(
            id=workspace.id,
            name=workspace.name,
            kind="colecao",
            workspace_id=workspace.id,
            workspace_name=workspace.name,
            workspace_slug=workspace.slug,
        )
        ranked.append((sort_key(tier, _KIND_ORDER["colecao"], workspace.name, workspace.id), entry))

    for report in reports:
        workspace = workspaces_by_id.get(report.collection_id)
        if not workspace:
            continue
        tier = match_tier(report.name, q)
        if tier is None:
            continue
        entry = SearchResultEntry(
            id=report.id,
            name=report.name,
            kind="relatorio",
            display_type=report.display_type,
            workspace_id=workspace.id,
            workspace_name=workspace.name,
            workspace_slug=workspace.slug,
        )
        ranked.append((sort_key(tier, _KIND_ORDER["relatorio"], report.name, report.id), entry))

    ranked.sort(key=lambda item: item[0])
    return [entry for _, entry in ranked[:MAX_RESULTS]]

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.workspace_deps import get_effective_roles_map
from app.models.report import Report
from app.models.user import User
from app.models.workspace import Workspace
from app.routers.auth import get_current_user
from app.schemas.report import DisplayType

router = APIRouter(prefix="/search", tags=["search"])


class SearchResultEntry(BaseModel):
    id: int
    name: str
    display_type: DisplayType
    workspace_id: int
    workspace_name: str
    workspace_slug: str


@router.get("/", response_model=list[SearchResultEntry])
def search_reports(q: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = q.strip()
    if not query:
        return []

    roles_by_workspace = get_effective_roles_map(db, current_user.id)
    accessible_workspace_ids = list(roles_by_workspace.keys())
    if not accessible_workspace_ids:
        return []

    matches = (
        db.query(Report)
        .filter(Report.name.ilike(f"%{query}%"), Report.collection_id.in_(accessible_workspace_ids))
        .limit(50)
        .all()
    )

    # Pre-carrega as colecoes dos resultados numa unica query (IN) em vez de uma query
    # por relatorio dentro do loop abaixo.
    workspace_ids = {report.collection_id for report in matches}
    workspaces_by_id = {w.id: w for w in db.query(Workspace).filter(Workspace.id.in_(workspace_ids)).all()}

    entries = []
    for report in matches:
        workspace = workspaces_by_id.get(report.collection_id)
        if not workspace:
            continue
        entries.append(
            SearchResultEntry(
                id=report.id,
                name=report.name,
                display_type=report.display_type,
                workspace_id=workspace.id,
                workspace_name=workspace.name,
                workspace_slug=workspace.slug,
            )
        )
        if len(entries) >= 10:
            break

    return entries

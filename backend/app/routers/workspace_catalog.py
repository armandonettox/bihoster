"""O modulo "Relatorios": o catalogo do tenant visto como workspaces do Power BI Service.

Entrada = lista de workspaces; dentro de um workspace, relatorios e modelos semanticos numa lista so (core/workspace_catalog.py).
Quem tem o catalogo geral ve tudo; as demais pessoas veem so o que receberam direto. Aqui tambem ficam as acoes de um modelo:
atualizar agora e o historico de atualizacao, cada uma com a sua permissao de modelo."""

from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import powerbi
from app.core.access_deps import require_dataset_permission
from app.core.audit import log_action
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.core.workspace_catalog import list_items, list_workspaces, scope_of_user
from app.models.catalog_sync import PbiDataset
from app.models.powerbi_connection import PowerBIConnection
from app.models.user import User
from app.routers import powerbi as embed_router
from app.routers.auth import get_current_user

router = APIRouter(prefix="/catalog", tags=["catalog"])


class WorkspaceRow(BaseModel):
    connection_id: Optional[int] = None
    connection_name: Optional[str] = None
    pbi_workspace_id: str
    name: str
    reports: int
    datasets: int
    last_synced_at: Optional[datetime] = None
    pending: int


class Face(BaseModel):
    kind: Literal["user", "group"]
    name: str
    picture_url: Optional[str] = None


class AccessSummary(BaseModel):
    count: int
    people: list[Face]


class RlsInfo(BaseModel):
    requires_identity: Optional[bool] = None
    role_grants: int = 0


class Can(BaseModel):
    open: bool
    share: bool
    security: bool
    refresh: bool
    history: bool
    folders: bool


class ItemRow(BaseModel):
    kind: Literal["report", "dataset"]
    id: int
    name: str
    connection_id: Optional[int] = None
    pbi_workspace_id: str
    pbi_workspace_name: str
    collection_id: Optional[int] = None
    folders: list[str]
    in_root: bool
    updated_at: Optional[datetime] = None
    # Da ultima e da proxima atualizacao dos dados, so quando o cache do aquecimento ja as tem (senao vazio)
    last_refresh_at: Optional[str] = None
    next_refresh_at: Optional[str] = None
    last_refresh_status: Optional[str] = None
    missing: bool
    dataset_id: Optional[int] = None
    dataset_name: Optional[str] = None
    reports_count: Optional[int] = None
    rls: RlsInfo
    access: AccessSummary
    pending: bool
    can: Can


class ItemsPage(BaseModel):
    items: list[ItemRow]
    total: int
    page: int
    page_size: int
    # Relatorios novos (ainda na Raiz) sem nenhum acesso, no filtro atual: o indicador discreto do topo
    pending_total: int


@router.get("/workspaces", response_model=list[WorkspaceRow])
def get_workspaces(search: str = Query("", max_length=100), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Os workspaces do tenant que a pessoa enxerga, com contagens. Sem permissao nenhuma, a lista vem vazia."""
    scope = scope_of_user(db, current_user.id)
    if not scope.any:
        return []
    from app.core.workspace_catalog import ensure_datasets_for_reports

    if ensure_datasets_for_reports(db):
        db.commit()
    return [WorkspaceRow(**row) for row in list_workspaces(db, scope, search)]


@router.get("/items", response_model=ItemsPage)
def get_items(
    connection_id: Optional[int] = None,
    workspace: Optional[str] = Query(None, max_length=100),
    kind: Literal["all", "report", "dataset"] = "all",
    search: str = Query("", max_length=100),
    sort: Literal["name", "kind", "updated", "access"] = "name",
    order: Literal["asc", "desc"] = "asc",
    pending: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    scope = scope_of_user(db, current_user.id)
    if not scope.any:
        return ItemsPage(items=[], total=0, page=page, page_size=page_size, pending_total=0)
    data = list_items(
        db,
        scope,
        connection_id=connection_id,
        workspace_id=workspace,
        kind=kind,
        search=search,
        sort=sort,
        descending=order == "desc",
        pending_only=pending,
        page=page,
        page_size=page_size,
    )
    return ItemsPage(**data)


class RefreshOut(BaseModel):
    status: str


class HistoryEntry(BaseModel):
    status: Optional[str] = None
    kind: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    error: Optional[str] = None


def _dataset_with_connection(db: Session, dataset_id: int) -> tuple[PbiDataset, PowerBIConnection]:
    dataset = db.query(PbiDataset).get(dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Modelo semantico nao encontrado")
    connection = db.query(PowerBIConnection).get(dataset.connection_id)
    if connection is None:
        raise HTTPException(status_code=400, detail="A conta do Power BI deste modelo nao existe mais")
    return dataset, connection


@router.post("/datasets/{dataset_id}/refresh", response_model=RefreshOut, status_code=202)
@limiter.limit("6/minute")
def refresh_dataset(
    request: Request,
    dataset_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_dataset_permission("modelo.atualizar")),
):
    """Pede ao Power BI a atualizacao dos dados do modelo. Quem pode e quem recebeu "atualizar" nele, ou o administrador."""
    dataset, connection = _dataset_with_connection(db, dataset_id)
    powerbi.refresh_dataset(connection, dataset.pbi_workspace_id, dataset.pbi_dataset_id)
    embed_router._refresh_info_cache.pop((connection.id, dataset.pbi_dataset_id), None)
    log_action(db, action="refresh", entity="dataset", user_id=current_user.id, entity_id=str(dataset.id), details=dataset.name[:200])
    return RefreshOut(status="requested")


@router.get("/datasets/{dataset_id}/history", response_model=list[HistoryEntry])
def refresh_history(
    dataset_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_dataset_permission("modelo.historico")),
):
    """As ultimas atualizacoes do modelo, como o Power BI as informa."""
    dataset, connection = _dataset_with_connection(db, dataset_id)
    rows = powerbi.get_refresh_history(connection, dataset.pbi_workspace_id, dataset.pbi_dataset_id, top=10)
    return [
        HistoryEntry(
            status=row.get("status"),
            kind=row.get("refreshType"),
            started_at=row.get("startTime"),
            ended_at=row.get("endTime"),
            error=(row.get("serviceExceptionJson") or "")[:300] or None,
        )
        for row in rows
    ]

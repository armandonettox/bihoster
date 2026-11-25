"""Catalogo do tenant do Power BI: sincronizacao por conta e listas de relatorios e modelos.

Tudo aqui e so de quem recebeu a permissao (conexao.sincronizar, relatorio.catalogo,
modelo.catalogo). As permissoes nao dao acesso ao conteudo dos relatorios: so ao que existe no
catalogo."""

import json
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core import catalog_sync, powerbi
from app.core.access_deps import require_global_permission
from app.core.audit import log_action
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models.catalog_sync import CatalogSync, PbiDataset
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.user import User
from app.models.workspace import Workspace

router = APIRouter(prefix="/powerbi-connections", tags=["catalog"])
catalog_router = APIRouter(prefix="/catalog", tags=["catalog"])

MAX_PAGE_SIZE = 100


def _connection_or_404(db: Session, connection_id: int) -> PowerBIConnection:
    connection = db.query(PowerBIConnection).get(connection_id)
    if not connection:
        raise HTTPException(status_code=404, detail="Conta do Power BI nao encontrada")
    return connection


class SyncJobOut(BaseModel):
    job_id: str


class SyncJobStatusOut(BaseModel):
    status: str
    message: str
    progress: int
    sync_id: Optional[int] = None


class SyncRecordOut(BaseModel):
    id: int
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    started_by_scheduler: bool
    reports_new: Optional[int] = None
    reports_updated: Optional[int] = None
    reports_missing: Optional[int] = None
    datasets_new: Optional[int] = None
    datasets_updated: Optional[int] = None
    datasets_missing: Optional[int] = None
    error: Optional[str] = None


class SyncStatusOut(BaseModel):
    last_sync: Optional[SyncRecordOut] = None
    workspace_ids: list[str]
    interval_hours: Optional[int] = None
    running_job_id: Optional[str] = None


class SyncSettingsIn(BaseModel):
    # Vazio = todos os workspaces do tenant
    workspace_ids: list[str] = Field(default_factory=list, max_length=500)
    # Nulo = so pelo botao
    interval_hours: Optional[int] = Field(default=None, ge=1, le=720)


class TenantWorkspaceOut(BaseModel):
    id: str
    name: str


def _record_out(record: CatalogSync) -> SyncRecordOut:
    return SyncRecordOut(
        id=record.id,
        started_at=record.started_at,
        finished_at=record.finished_at,
        started_by_scheduler=record.started_by_user_id is None,
        reports_new=record.reports_new,
        reports_updated=record.reports_updated,
        reports_missing=record.reports_missing,
        datasets_new=record.datasets_new,
        datasets_updated=record.datasets_updated,
        datasets_missing=record.datasets_missing,
        error=record.error,
    )


@router.post("/{connection_id}/sync", response_model=SyncJobOut, status_code=202)
@limiter.limit("6/minute")
def start_sync(
    request: Request,
    connection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("conexao.sincronizar")),
):
    """Sincroniza o catalogo da conta em segundo plano e devolve o id do trabalho. Se a conta ja
    esta sincronizando, devolve o trabalho que esta rodando."""
    _connection_or_404(db, connection_id)
    job = catalog_sync.start_in_background(connection_id, current_user.id)
    return SyncJobOut(job_id=job.id)


@router.get("/{connection_id}/sync-jobs/{job_id}", response_model=SyncJobStatusOut)
def get_sync_job(
    connection_id: int,
    job_id: str,
    _: User = Depends(require_global_permission("conexao.sincronizar")),
):
    job = catalog_sync.get_job(job_id)
    if job is None or job.connection_id != connection_id:
        raise HTTPException(status_code=404, detail="Sincronizacao nao encontrada")
    return SyncJobStatusOut(status=job.status, message=job.message, progress=job.progress, sync_id=job.sync_id)


@router.get("/{connection_id}/sync-status", response_model=SyncStatusOut)
def get_sync_status(
    connection_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_global_permission("conexao.sincronizar")),
):
    connection = _connection_or_404(db, connection_id)
    last = db.query(CatalogSync).filter(CatalogSync.connection_id == connection_id).order_by(CatalogSync.id.desc()).first()
    running = catalog_sync.running_job_for(connection_id)
    return SyncStatusOut(
        last_sync=_record_out(last) if last else None,
        workspace_ids=catalog_sync.selected_workspace_ids(connection),
        interval_hours=connection.sync_interval_hours,
        running_job_id=running.id if running else None,
    )


@router.put("/{connection_id}/sync-settings", response_model=SyncStatusOut)
def update_sync_settings(
    connection_id: int,
    data: SyncSettingsIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("conexao.sincronizar")),
):
    """Escolhe quais workspaces importar (vazio = todos) e de quantas em quantas horas sincronizar
    sozinho (nulo = so pelo botao)."""
    connection = _connection_or_404(db, connection_id)
    unique_ids = list(dict.fromkeys(item.strip() for item in data.workspace_ids if item.strip()))
    if any(len(item) > 100 for item in unique_ids):
        raise HTTPException(status_code=422, detail="Identificador de workspace invalido")
    connection.sync_workspaces_json = json.dumps(unique_ids) if unique_ids else None
    connection.sync_interval_hours = data.interval_hours
    db.commit()
    log_action(
        db,
        action="catalog_sync_settings",
        entity="powerbi_connection",
        user_id=current_user.id,
        entity_id=str(connection_id),
        details=f"{len(unique_ids) or 'todos'} workspaces, agenda: {data.interval_hours or 'so pelo botao'}",
    )
    return get_sync_status(connection_id, db, current_user)


@router.get("/{connection_id}/tenant-workspaces", response_model=list[TenantWorkspaceOut])
def list_tenant_workspaces(
    connection_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_global_permission("conexao.sincronizar")),
):
    """Os workspaces do tenant, para escolher quais importar na janela da sincronizacao."""
    connection = _connection_or_404(db, connection_id)
    workspaces = catalog_sync._with_retry(lambda: powerbi.list_workspaces(connection))
    return sorted(
        [TenantWorkspaceOut(id=w["id"], name=w.get("name") or w["id"]) for w in workspaces],
        key=lambda w: w.name.lower(),
    )


class CatalogReportOut(BaseModel):
    id: int
    name: str
    connection_id: Optional[int] = None
    connection_name: Optional[str] = None
    pbi_workspace_id: str
    pbi_workspace_name: Optional[str] = None
    pbi_report_id: str
    pbi_dataset_id: Optional[str] = None
    source: Optional[str] = None
    in_root: bool
    collection_id: int
    collection_name: str
    synced_at: Optional[datetime] = None
    sync_missing_at: Optional[datetime] = None


class CatalogReportPage(BaseModel):
    items: list[CatalogReportOut]
    total: int
    page: int
    page_size: int


class CatalogDatasetOut(BaseModel):
    id: int
    name: str
    connection_id: int
    connection_name: Optional[str] = None
    pbi_workspace_id: str
    pbi_workspace_name: Optional[str] = None
    pbi_dataset_id: str
    requires_identity: Optional[bool] = None
    reports_count: int
    synced_at: Optional[datetime] = None
    sync_missing_at: Optional[datetime] = None


class CatalogDatasetPage(BaseModel):
    items: list[CatalogDatasetOut]
    total: int
    page: int
    page_size: int


def _like(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@catalog_router.get("/reports", response_model=CatalogReportPage)
def list_catalog_reports(
    search: Optional[str] = None,
    workspace: Optional[str] = None,
    connection_id: Optional[int] = None,
    state: Literal["all", "missing", "ok"] = "all",
    where: Literal["all", "root", "collections"] = "all",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    _: User = Depends(require_global_permission("relatorio.catalogo")),
):
    """Todos os relatorios do portal (importados e cadastrados a mao), paginados. Filtros: texto,
    workspace de origem, conta, estado (nao encontrado no Power BI) e onde estao (Raiz ou colecoes)."""
    query = db.query(Report, Workspace, PowerBIConnection.name).join(Workspace, Workspace.id == Report.collection_id).outerjoin(
        PowerBIConnection, PowerBIConnection.id == Report.powerbi_connection_id
    )
    if search:
        like = _like(search.strip())
        query = query.filter(or_(Report.name.ilike(like, escape="\\"), Report.pbi_workspace_name.ilike(like, escape="\\")))
    if workspace:
        query = query.filter(Report.pbi_workspace_name == workspace)
    if connection_id is not None:
        query = query.filter(Report.powerbi_connection_id == connection_id)
    if state == "missing":
        query = query.filter(Report.sync_missing_at.isnot(None))
    elif state == "ok":
        query = query.filter(Report.sync_missing_at.is_(None))
    if where == "root":
        query = query.filter(Workspace.system_key.isnot(None))
    elif where == "collections":
        query = query.filter(Workspace.system_key.is_(None))

    total = query.count()
    rows = query.order_by(Report.name, Report.id).offset((page - 1) * page_size).limit(page_size).all()
    items = [
        CatalogReportOut(
            id=report.id,
            name=report.name,
            connection_id=report.powerbi_connection_id,
            connection_name=connection_name,
            pbi_workspace_id=report.pbi_workspace_id,
            pbi_workspace_name=report.pbi_workspace_name,
            pbi_report_id=report.pbi_report_id,
            pbi_dataset_id=report.pbi_dataset_id,
            source=report.source,
            in_root=collection.system_key is not None,
            collection_id=collection.id,
            collection_name=collection.name,
            synced_at=report.synced_at,
            sync_missing_at=report.sync_missing_at,
        )
        for report, collection, connection_name in rows
    ]
    return CatalogReportPage(items=items, total=total, page=page, page_size=page_size)


@catalog_router.get("/origins", response_model=list[str])
def list_catalog_origins(db: Session = Depends(get_db), _: User = Depends(require_global_permission("relatorio.catalogo"))):
    """Nomes dos workspaces de origem que existem no catalogo, para o filtro da lista."""
    rows = db.query(Report.pbi_workspace_name).filter(Report.pbi_workspace_name.isnot(None)).distinct().all()
    return sorted({row[0] for row in rows}, key=str.lower)


@catalog_router.get("/datasets", response_model=CatalogDatasetPage)
def list_catalog_datasets(
    search: Optional[str] = None,
    workspace: Optional[str] = None,
    connection_id: Optional[int] = None,
    state: Literal["all", "missing", "ok"] = "all",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    _: User = Depends(require_global_permission("modelo.catalogo")),
):
    query = db.query(PbiDataset, PowerBIConnection.name).outerjoin(PowerBIConnection, PowerBIConnection.id == PbiDataset.connection_id)
    if search:
        like = _like(search.strip())
        query = query.filter(or_(PbiDataset.name.ilike(like, escape="\\"), PbiDataset.pbi_workspace_name.ilike(like, escape="\\")))
    if workspace:
        query = query.filter(PbiDataset.pbi_workspace_name == workspace)
    if connection_id is not None:
        query = query.filter(PbiDataset.connection_id == connection_id)
    if state == "missing":
        query = query.filter(PbiDataset.sync_missing_at.isnot(None))
    elif state == "ok":
        query = query.filter(PbiDataset.sync_missing_at.is_(None))

    total = query.count()
    rows = query.order_by(PbiDataset.name, PbiDataset.id).offset((page - 1) * page_size).limit(page_size).all()
    counts = {}
    if rows:
        dataset_ids = [dataset.pbi_dataset_id for dataset, _ in rows]
        counts = {
            (cid, did): n
            for cid, did, n in db.query(Report.powerbi_connection_id, Report.pbi_dataset_id, func.count(Report.id))
            .filter(Report.pbi_dataset_id.in_(dataset_ids))
            .group_by(Report.powerbi_connection_id, Report.pbi_dataset_id)
            .all()
        }
    items = [
        CatalogDatasetOut(
            id=dataset.id,
            name=dataset.name,
            connection_id=dataset.connection_id,
            connection_name=connection_name,
            pbi_workspace_id=dataset.pbi_workspace_id,
            pbi_workspace_name=dataset.pbi_workspace_name,
            pbi_dataset_id=dataset.pbi_dataset_id,
            requires_identity=dataset.is_effective_identity_required,
            reports_count=counts.get((dataset.connection_id, dataset.pbi_dataset_id), 0),
            synced_at=dataset.synced_at,
            sync_missing_at=dataset.sync_missing_at,
        )
        for dataset, connection_name in rows
    ]
    return CatalogDatasetPage(items=items, total=total, page=page, page_size=page_size)

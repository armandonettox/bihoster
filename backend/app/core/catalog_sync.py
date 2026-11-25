"""Sincronizacao do catalogo: traz para o portal os workspaces, relatorios e modelos semanticos
publicados no tenant do Power BI de uma conta.

Regras (ver o plano do catalogo na raiz):
- A identidade de um relatorio e (conta, pbi_workspace_id, pbi_report_id). Rodar duas vezes seguidas
  nao duplica nada.
- Relatorio novo vai para a colecao interna "Raiz" (so administradores veem) com source="sync".
- Relatorio que ja existe e foi cadastrado a mao e "adotado": fica na colecao em que esta e o nome
  nao muda (nao muda o que as pessoas veem hoje); so recebe a data da sincronizacao, o nome do
  workspace de origem e o dataset, se estava vazio.
- Relatorio que deixou de aparecer no tenant recebe sync_missing_at e continua no portal com as
  permissoes. Nunca e apagado. So se marca "nao encontrado" onde a listagem do workspace deu certo:
  uma falha de rede ou de permissao nao pode fazer tudo parecer removido.
- O Power BI limita as chamadas (HTTP 429): a sincronizacao espera e tenta de novo, uma conta por vez."""

import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional

from sqlalchemy.orm import Session

from app.core import powerbi
from app.core.audit import log_action
from app.core.database import SessionLocal
from app.core.root_collection import ensure_root_collection
from app.core.workspace_catalog import ensure_datasets_for_reports
from app.models.catalog_sync import CatalogSync, PbiDataset
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report

logger = logging.getLogger(__name__)

# Esperas (segundos) entre as tentativas quando o Power BI responde 429; trocavel nos testes
RETRY_WAITS = (5, 15, 45)
_sleep: Callable[[float], None] = time.sleep

_JOB_TTL_SECONDS = 3600
_MAX_JOBS = 100

# Uma conta por vez: o botao e a rotina agendada nunca sincronizam a mesma conta ao mesmo tempo
_connection_locks: dict[int, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(connection_id: int) -> threading.Lock:
    with _locks_guard:
        return _connection_locks.setdefault(connection_id, threading.Lock())


def _now() -> datetime:
    return datetime.now(timezone.utc)


def selected_workspace_ids(connection: PowerBIConnection) -> list[str]:
    """Ids dos workspaces escolhidos para importar; vazio = todos."""
    if not connection.sync_workspaces_json:
        return []
    try:
        parsed = json.loads(connection.sync_workspaces_json)
    except ValueError:
        return []
    return [item for item in parsed if isinstance(item, str)] if isinstance(parsed, list) else []


def _with_retry(call: Callable[[], list[dict]]) -> list[dict]:
    """Chama o Power BI e, se ele limitar as chamadas (429), espera e tenta de novo."""
    for attempt in range(len(RETRY_WAITS) + 1):
        try:
            return call()
        except powerbi.PowerBIError as exc:
            if "HTTP 429" not in str(exc) or attempt == len(RETRY_WAITS):
                raise
            _sleep(RETRY_WAITS[attempt])
    return []  # inalcancavel; satisfaz o verificador de tipos


@dataclass
class SyncCounts:
    reports_new: int = 0
    reports_updated: int = 0
    reports_missing: int = 0
    datasets_new: int = 0
    datasets_updated: int = 0
    datasets_missing: int = 0
    failed_workspaces: list[str] = field(default_factory=list)


def _sync_reports(db: Session, connection: PowerBIConnection, workspace: dict, listed: list[dict], root_id: int, counts: SyncCounts) -> None:
    now = _now()
    workspace_id, workspace_name = workspace["id"], workspace.get("name")
    existing = (
        db.query(Report)
        .filter(Report.powerbi_connection_id == connection.id, Report.pbi_workspace_id == workspace_id)
        .all()
    )
    by_report_id: dict[str, list[Report]] = {}
    for row in existing:
        by_report_id.setdefault(row.pbi_report_id, []).append(row)

    seen: set[str] = set()
    for item in listed:
        report_id = item["id"]
        seen.add(report_id)
        rows = by_report_id.get(report_id)
        if not rows:
            db.add(
                Report(
                    collection_id=root_id,
                    name=item.get("name") or report_id,
                    powerbi_connection_id=connection.id,
                    pbi_workspace_id=workspace_id,
                    pbi_report_id=report_id,
                    pbi_dataset_id=item.get("datasetId"),
                    display_type="relatorio",
                    source="sync",
                    synced_at=now,
                    pbi_workspace_name=workspace_name,
                )
            )
            counts.reports_new += 1
            continue
        for row in rows:
            changed = False
            if row.source == "sync" and item.get("name") and row.name != item["name"]:
                row.name = item["name"]
                changed = True
            if item.get("datasetId") and row.pbi_dataset_id != item.get("datasetId") and (row.source == "sync" or not row.pbi_dataset_id):
                row.pbi_dataset_id = item["datasetId"]
                changed = True
            if row.pbi_workspace_name != workspace_name:
                row.pbi_workspace_name = workspace_name
                changed = True
            if row.sync_missing_at is not None:
                row.sync_missing_at = None
                changed = True
            row.synced_at = now
            if changed:
                counts.reports_updated += 1

    for report_id, rows in by_report_id.items():
        if report_id in seen:
            continue
        for row in rows:
            if row.sync_missing_at is None:
                row.sync_missing_at = now
                counts.reports_missing += 1


def _sync_datasets(db: Session, connection: PowerBIConnection, workspace: dict, listed: list[dict], counts: SyncCounts) -> None:
    now = _now()
    workspace_id, workspace_name = workspace["id"], workspace.get("name")
    existing = {
        row.pbi_dataset_id: row
        for row in db.query(PbiDataset).filter(PbiDataset.connection_id == connection.id, PbiDataset.pbi_workspace_id == workspace_id).all()
    }
    seen: set[str] = set()
    for item in listed:
        dataset_id = item["id"]
        seen.add(dataset_id)
        row = existing.get(dataset_id)
        needs_identity = item.get("isEffectiveIdentityRequired")
        if row is None:
            db.add(
                PbiDataset(
                    connection_id=connection.id,
                    pbi_workspace_id=workspace_id,
                    pbi_workspace_name=workspace_name,
                    pbi_dataset_id=dataset_id,
                    name=item.get("name") or dataset_id,
                    is_effective_identity_required=needs_identity,
                    synced_at=now,
                )
            )
            counts.datasets_new += 1
            continue
        changed = row.name != (item.get("name") or dataset_id) or row.pbi_workspace_name != workspace_name or row.sync_missing_at is not None
        row.name = item.get("name") or dataset_id
        row.pbi_workspace_name = workspace_name
        row.is_effective_identity_required = needs_identity
        row.sync_missing_at = None
        row.synced_at = now
        if changed:
            counts.datasets_updated += 1
    for dataset_id, row in existing.items():
        if dataset_id not in seen and row.sync_missing_at is None:
            row.sync_missing_at = now
            counts.datasets_missing += 1


def _mark_removed_workspaces(db: Session, connection: PowerBIConnection, tenant_ids: set[str], counts: SyncCounts) -> None:
    """Workspaces que sumiram do tenant: tudo o que o portal conhece deles vira "nao encontrado"."""
    now = _now()
    for row in db.query(Report).filter(Report.powerbi_connection_id == connection.id).all():
        if row.pbi_workspace_id not in tenant_ids and row.sync_missing_at is None:
            row.sync_missing_at = now
            counts.reports_missing += 1
    for row in db.query(PbiDataset).filter(PbiDataset.connection_id == connection.id).all():
        if row.pbi_workspace_id not in tenant_ids and row.sync_missing_at is None:
            row.sync_missing_at = now
            counts.datasets_missing += 1


def sync_connection(
    db: Session,
    connection: PowerBIConnection,
    user_id: Optional[int] = None,
    on_progress: Optional[Callable[[int, str], None]] = None,
) -> CatalogSync:
    """Sincroniza uma conta e devolve a linha de historico (com contagens ou erro). Nao levanta
    excecao do Power BI: a falha fica gravada em `error`."""
    progress = on_progress or (lambda percent, message: None)
    record = CatalogSync(connection_id=connection.id, started_by_user_id=user_id)
    db.add(record)
    db.commit()
    db.refresh(record)
    counts = SyncCounts()
    error: Optional[str] = None
    try:
        progress(5, "Listando os workspaces do tenant.")
        tenant_workspaces = _with_retry(lambda: powerbi.list_workspaces(connection))
        tenant_ids = {w["id"] for w in tenant_workspaces}
        chosen = set(selected_workspace_ids(connection))
        scope = [w for w in tenant_workspaces if not chosen or w["id"] in chosen]
        root = ensure_root_collection(db)

        listed_ok_everywhere = True
        for index, workspace in enumerate(scope, start=1):
            progress(5 + int(90 * index / max(len(scope), 1)), f"Workspace {index} de {len(scope)}: {workspace.get('name') or workspace['id']}")
            try:
                reports = _with_retry(lambda: powerbi.list_reports(connection, workspace["id"]))
            except powerbi.PowerBIError as exc:
                counts.failed_workspaces.append(f"{workspace.get('name') or workspace['id']}: {str(exc)[:160]}")
                listed_ok_everywhere = False
                continue
            _sync_reports(db, connection, workspace, reports, root.id, counts)
            try:
                datasets = _with_retry(lambda: powerbi.list_datasets(connection, workspace["id"]))
                _sync_datasets(db, connection, workspace, datasets, counts)
            except powerbi.PowerBIError as exc:
                # Modelos sao um extra: a falha entra no aviso, mas nao desfaz os relatorios
                counts.failed_workspaces.append(f"{workspace.get('name') or workspace['id']} (modelos): {str(exc)[:160]}")
            db.commit()

        # Modelos que os relatorios ja usam e a API nao trouxe: ficam na lista com o id curto (nunca somem da tela)
        ensure_datasets_for_reports(db, connection.id)
        db.commit()

        # So marca workspaces removidos quando a lista do tenant veio completa (filtro vazio)
        if not chosen and listed_ok_everywhere:
            _mark_removed_workspaces(db, connection, tenant_ids, counts)
            db.commit()
        if counts.failed_workspaces:
            error = "Alguns workspaces nao puderam ser lidos: " + "; ".join(counts.failed_workspaces[:5])
    except powerbi.PowerBIError as exc:
        db.rollback()
        error = str(exc)[:500]
    except Exception as exc:  # noqa: BLE001 -- a rotina agendada nao pode morrer por um erro inesperado
        db.rollback()
        logger.exception("sincronizacao do catalogo falhou (conta %s)", connection.id)
        error = f"Erro inesperado: {type(exc).__name__}"

    record = db.query(CatalogSync).get(record.id)
    record.finished_at = _now()
    record.reports_new = counts.reports_new
    record.reports_updated = counts.reports_updated
    record.reports_missing = counts.reports_missing
    record.datasets_new = counts.datasets_new
    record.datasets_updated = counts.datasets_updated
    record.datasets_missing = counts.datasets_missing
    record.error = error
    db.commit()

    from app.routers.powerbi_catalog import invalidate_catalog_cache  # import aqui: o roteador importa este modulo

    invalidate_catalog_cache(connection.id)
    log_action(
        db,
        action="catalog_sync" if error is None else "catalog_sync_failed",
        entity="powerbi_connection",
        user_id=user_id,
        entity_id=str(connection.id),
        details=(
            f"{counts.reports_new} novos, {counts.reports_updated} atualizados, {counts.reports_missing} nao encontrados"
            if error is None
            else error[:300]
        ),
    )
    progress(100, "Sincronizacao concluida." if error is None else "Sincronizacao terminou com aviso.")
    return record


@dataclass
class SyncJob:
    id: str
    connection_id: int
    user_id: Optional[int]
    status: str = "queued"  # queued, running, done, error
    message: str = "Na fila."
    progress: int = 0
    sync_id: Optional[int] = None
    created_at: float = field(default_factory=time.monotonic)

    @property
    def finished(self) -> bool:
        return self.status in ("done", "error")


_jobs: dict[str, SyncJob] = {}
_jobs_lock = threading.Lock()


def _prune_jobs() -> None:
    now = time.monotonic()
    for job_id in [j for j, job in _jobs.items() if job.finished and now - job.created_at > _JOB_TTL_SECONDS]:
        _jobs.pop(job_id, None)
    while len(_jobs) > _MAX_JOBS:
        finished = [j for j, job in _jobs.items() if job.finished]
        if not finished:
            break
        _jobs.pop(finished[0], None)


def get_job(job_id: str) -> Optional[SyncJob]:
    with _jobs_lock:
        return _jobs.get(job_id)


def running_job_for(connection_id: int) -> Optional[SyncJob]:
    with _jobs_lock:
        return next((j for j in _jobs.values() if j.connection_id == connection_id and not j.finished), None)


def start_in_background(connection_id: int, user_id: Optional[int], run: Callable[[SyncJob], None] | None = None) -> SyncJob:
    """Cria o trabalho e o executa numa thread. Se a conta ja esta sincronizando, devolve o
    trabalho que esta rodando em vez de abrir outro."""
    with _jobs_lock:
        _prune_jobs()
        running = next((j for j in _jobs.values() if j.connection_id == connection_id and not j.finished), None)
        if running is not None:
            return running
        job = SyncJob(id=uuid.uuid4().hex, connection_id=connection_id, user_id=user_id)
        _jobs[job.id] = job
    threading.Thread(target=run or _run_job, args=(job,), name=f"catalog-sync-{connection_id}", daemon=True).start()
    return job


def _run_job(job: SyncJob) -> None:
    with _lock_for(job.connection_id):
        job.status = "running"
        job.message = "Iniciando."
        db = SessionLocal()
        try:
            connection = db.query(PowerBIConnection).get(job.connection_id)
            if connection is None:
                job.status, job.message = "error", "Conta do Power BI nao encontrada."
                return

            def progress(percent: int, message: str) -> None:
                job.progress, job.message = percent, message

            record = sync_connection(db, connection, job.user_id, progress)
            job.sync_id = record.id
            job.status = "error" if record.error else "done"
            job.progress = 100
            if record.error:
                job.message = record.error
        except Exception as exc:  # noqa: BLE001
            logger.exception("trabalho de sincronizacao falhou")
            job.status, job.message = "error", f"Erro inesperado: {type(exc).__name__}"
        finally:
            db.close()


def run_scheduled_once() -> int:
    """Chamado pela rotina agendada: sincroniza cada conta cuja ultima rodada e mais antiga que o
    intervalo escolhido. Devolve quantas contas sincronizou."""
    db = SessionLocal()
    done = 0
    try:
        for connection in db.query(PowerBIConnection).filter(PowerBIConnection.sync_interval_hours.isnot(None)).all():
            if not connection.sync_interval_hours or connection.sync_interval_hours < 1:
                continue
            last = (
                db.query(CatalogSync)
                .filter(CatalogSync.connection_id == connection.id)
                .order_by(CatalogSync.started_at.desc())
                .first()
            )
            if last is not None and last.started_at is not None:
                started = last.started_at if last.started_at.tzinfo else last.started_at.replace(tzinfo=timezone.utc)
                if (_now() - started).total_seconds() < connection.sync_interval_hours * 3600:
                    continue
            if running_job_for(connection.id) is not None:
                continue
            with _lock_for(connection.id):
                sync_connection(db, connection, None)
            done += 1
    finally:
        db.close()
    return done

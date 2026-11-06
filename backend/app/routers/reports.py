import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import powerbi, report_delivery
from app.core.audit import log_action
from app.core.database import get_db
from app.core.workspace_deps import require_workspace_member, require_workspace_role
from app.models.favorite import Favorite
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.subscription import delete_subscriptions_of_reports
from app.models.user import User, UserRole
from app.routers.powerbi import invalidate_embed_cache
from app.schemas.report import ReportCreate, ReportMove, ReportOut, ReportUpdate, resolve_page_names

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "static" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/workspaces/{workspace_id}/reports", tags=["reports"])

# Campos de aba tratados a parte (viram a coluna JSON + a primeira aba, via Report.set_page_names)
_PAGE_FIELDS = {"pbi_page_name", "pbi_page_names"}


def _validate_connection_exists(db: Session, connection_id: int) -> None:
    if not db.query(PowerBIConnection).get(connection_id):
        raise HTTPException(status_code=400, detail="Conta do Power BI selecionada nao existe")


def _ordered_reports(db: Session, workspace_id: int) -> list[Report]:
    """Relatorios da colecao na ordem de exibicao: com posicao primeiro (menor antes), depois os
    sem posicao, e a criacao (id) desempata. Sem ORDER BY o SQLite devolve numa ordem nao
    garantida, e a ordem define a sequencia do Modo TV e da Apresentacao."""
    return (
        db.query(Report)
        .filter(Report.collection_id == workspace_id)
        .order_by(Report.position.is_(None), Report.position, Report.id)
        .all()
    )


@router.get("/", response_model=list[ReportOut])
def list_reports(workspace_id: int, db: Session = Depends(get_db), _=Depends(require_workspace_member)):
    return _ordered_reports(db, workspace_id)


@router.get("/{report_id}", response_model=ReportOut)
def get_report(
    workspace_id: int,
    report_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_workspace_member),
):
    report = db.query(Report).filter(Report.id == report_id, Report.collection_id == workspace_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")
    return report


@router.post("/", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
def create_report(
    workspace_id: int,
    data: ReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workspace_role(UserRole.admin, UserRole.editor)),
):
    _validate_connection_exists(db, data.powerbi_connection_id)
    report = Report(collection_id=workspace_id, **data.model_dump(exclude=_PAGE_FIELDS))
    page_names = resolve_page_names(data)
    if page_names is not None:
        report.set_page_names(page_names)
    db.add(report)
    db.commit()
    db.refresh(report)

    log_action(db, action="create", entity="report", user_id=current_user.id, workspace_id=workspace_id, entity_id=report.id, details=report.name)
    return report


@router.put("/{report_id}", response_model=ReportOut)
def update_report(
    workspace_id: int,
    report_id: int,
    data: ReportUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workspace_role(UserRole.admin, UserRole.editor)),
):
    report = db.query(Report).filter(Report.id == report_id, Report.collection_id == workspace_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")

    changed_fields = data.model_dump(exclude_unset=True, exclude=_PAGE_FIELDS)
    if "powerbi_connection_id" in changed_fields:
        _validate_connection_exists(db, changed_fields["powerbi_connection_id"])
    for field, value in changed_fields.items():
        setattr(report, field, value)
    page_names = resolve_page_names(data)
    if page_names is not None:
        report.set_page_names(page_names)

    db.commit()
    db.refresh(report)
    invalidate_embed_cache(workspace_id, report_id)

    log_action(db, action="update", entity="report", user_id=current_user.id, workspace_id=workspace_id, entity_id=report.id, details=report.name)
    return report


@router.post("/{report_id}/move", response_model=list[ReportOut])
def move_report(
    workspace_id: int,
    report_id: int,
    data: ReportMove,
    db: Session = Depends(get_db),
    _=Depends(require_workspace_role(UserRole.admin, UserRole.editor)),
):
    """Sobe ou desce um relatorio dentro da propria secao (mesmo display_type). Devolve a lista
    inteira da colecao ja na nova ordem, pro cliente atualizar sem outra requisicao."""
    everything = _ordered_reports(db, workspace_id)
    report = next((r for r in everything if r.id == report_id), None)
    if report is None:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")

    # A secao do relatorio, na ordem atual. Renumera 0..n-1 antes de trocar: relatorios ainda sem
    # posicao (nulo) ou com posicoes repetidas ficam com uma ordem explicita e estavel.
    section = [r for r in everything if r.display_type == report.display_type]
    for index, item in enumerate(section):
        item.position = index

    index = section.index(report)
    neighbour = index - 1 if data.direction == "up" else index + 1
    if 0 <= neighbour < len(section):
        section[index].position, section[neighbour].position = section[neighbour].position, section[index].position

    db.commit()
    return _ordered_reports(db, workspace_id)


class ThumbnailRefresh(BaseModel):
    page_name: str | None = None


def _get_connection(db: Session, report: Report) -> PowerBIConnection:
    if not report.powerbi_connection_id:
        raise HTTPException(status_code=400, detail="Relatorio nao tem conta Power BI configurada")
    conn = db.query(PowerBIConnection).get(report.powerbi_connection_id)
    if not conn:
        raise HTTPException(status_code=400, detail="Conta Power BI do relatorio nao encontrada")
    return conn


def _delete_thumbnail_file(thumbnail_url: str | None) -> None:
    if not thumbnail_url:
        return
    filename = thumbnail_url.rsplit("/", 1)[-1]
    old_path = UPLOAD_DIR / filename
    old_path.unlink(missing_ok=True)


@router.get("/{report_id}/pages")
def list_report_pages(
    workspace_id: int,
    report_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_workspace_member),
):
    """Paginas (abas) publicadas no relatorio -- usado para escolher de qual pagina gerar o thumbnail."""
    report = db.query(Report).filter(Report.id == report_id, Report.collection_id == workspace_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")
    conn = _get_connection(db, report)
    try:
        pages = powerbi.list_pages(conn, report.pbi_workspace_id, report.pbi_report_id)
    except powerbi.PowerBIError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return [{"name": p["name"], "display_name": p.get("displayName") or p["name"]} for p in pages]


class ThumbnailJobOut(BaseModel):
    job_id: str


class ThumbnailJobStatusOut(BaseModel):
    status: str
    message: str
    progress: int


@router.post("/{report_id}/thumbnail", response_model=ThumbnailJobOut, status_code=202)
def refresh_thumbnail(
    workspace_id: int,
    report_id: int,
    data: ThumbnailRefresh,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workspace_role(UserRole.admin, UserRole.editor)),
):
    """Inicia a geracao do thumbnail em background via ExportTo PNG do Power BI. Devolve o job_id."""
    report = db.query(Report).filter(Report.id == report_id, Report.collection_id == workspace_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")
    conn = _get_connection(db, report)

    # Snapshot dos valores necessarios -- a sessao fecha apos a resposta
    from app.routers.powerbi import _connection_snapshot
    conn_snapshot = _connection_snapshot(conn)
    old_thumbnail_url = report.thumbnail_url

    job = report_delivery.create_job(current_user.id)
    report_delivery.start_thumbnail_in_background(
        job=job,
        connection=conn_snapshot,
        pbi_workspace_id=report.pbi_workspace_id,
        pbi_report_id=report.pbi_report_id,
        page_name=data.page_name,
        report_id=report_id,
        upload_dir=UPLOAD_DIR,
        old_thumbnail_url=old_thumbnail_url,
    )
    log_action(db, action="update", entity="report", user_id=current_user.id, workspace_id=workspace_id, entity_id=report.id, details=f"thumbnail_requested:{report.name}")
    return ThumbnailJobOut(job_id=job.id)


@router.get("/{report_id}/thumbnail/jobs/{job_id}", response_model=ThumbnailJobStatusOut)
def get_thumbnail_job(
    workspace_id: int,
    report_id: int,
    job_id: str,
    current_user: User = Depends(require_workspace_role(UserRole.admin, UserRole.editor)),
):
    """Consulta o status de uma geracao de thumbnail em andamento."""
    job = report_delivery.get_job(job_id, current_user.id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job nao encontrado")
    return ThumbnailJobStatusOut(status=job.status, message=job.message, progress=job.progress)


@router.delete("/{report_id}/thumbnail", response_model=ReportOut)
def clear_thumbnail(
    workspace_id: int,
    report_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_workspace_role(UserRole.admin, UserRole.editor)),
):
    """Remove o thumbnail estatico do relatorio (volta a mostrar o embed ao vivo)."""
    report = db.query(Report).filter(Report.id == report_id, Report.collection_id == workspace_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")
    _delete_thumbnail_file(report.thumbnail_url)
    report.thumbnail_url = None
    db.commit()
    db.refresh(report)
    return report


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(
    workspace_id: int,
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workspace_role(UserRole.admin, UserRole.editor)),
):
    report = db.query(Report).filter(Report.id == report_id, Report.collection_id == workspace_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")

    report_name = report.name
    db.query(Favorite).filter(Favorite.report_id == report_id).delete(synchronize_session=False)
    delete_subscriptions_of_reports(db, [report_id])
    db.delete(report)
    db.commit()
    invalidate_embed_cache(workspace_id, report_id)

    log_action(db, action="delete", entity="report", user_id=current_user.id, workspace_id=workspace_id, entity_id=report_id, details=report_name)

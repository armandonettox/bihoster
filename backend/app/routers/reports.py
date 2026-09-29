from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.workspace_deps import require_workspace_member, require_workspace_role
from app.models.favorite import Favorite
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.user import User, UserRole
from app.routers.powerbi import invalidate_embed_cache
from app.schemas.report import ReportCreate, ReportMove, ReportOut, ReportUpdate

router = APIRouter(prefix="/workspaces/{workspace_id}/reports", tags=["reports"])


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
    report = Report(collection_id=workspace_id, **data.model_dump())
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

    changed_fields = data.model_dump(exclude_unset=True)
    if "powerbi_connection_id" in changed_fields:
        _validate_connection_exists(db, changed_fields["powerbi_connection_id"])
    for field, value in changed_fields.items():
        setattr(report, field, value)

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
    db.delete(report)
    db.commit()
    invalidate_embed_cache(workspace_id, report_id)

    log_action(db, action="delete", entity="report", user_id=current_user.id, workspace_id=workspace_id, entity_id=report_id, details=report_name)

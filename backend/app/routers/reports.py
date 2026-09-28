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
from app.schemas.report import ReportCreate, ReportOut, ReportUpdate

router = APIRouter(prefix="/workspaces/{workspace_id}/reports", tags=["reports"])


def _validate_connection_exists(db: Session, connection_id: int) -> None:
    if not db.query(PowerBIConnection).get(connection_id):
        raise HTTPException(status_code=400, detail="Conta do Power BI selecionada nao existe")


@router.get("/", response_model=list[ReportOut])
def list_reports(workspace_id: int, db: Session = Depends(get_db), _=Depends(require_workspace_member)):
    return db.query(Report).filter(Report.collection_id == workspace_id).all()


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

from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.core import powerbi
from app.core.audit import log_action
from app.core.database import get_db
from app.core.workspace_deps import require_workspace_role
from app.models.alert import ALERT_CONDITIONS, ReportAlert
from app.models.report import Report
from app.models.user import User, UserRole
from app.models.workspace import Workspace
from app.routers import powerbi as embed_router
from app.schemas.alert import AlertCreate, AlertOut, AlertUpdate, MeasureOut

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["alerts"])

can_manage = require_workspace_role(UserRole.admin, UserRole.editor)

MAX_PER_REPORT = 20


def _isoformat(dt) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _out(db: Session, alert: ReportAlert) -> AlertOut:
    report = db.get(Report, alert.report_id)
    workspace = db.get(Workspace, report.collection_id) if report else None
    return AlertOut(
        id=alert.id,
        report_id=alert.report_id,
        report_name=report.name if report else "(relatorio removido)",
        collection_id=report.collection_id if report else 0,
        collection_name=workspace.name if workspace else None,
        created_by_name=alert.created_by_name,
        name=alert.name,
        measure_name=alert.measure_name,
        table_name=alert.table_name,
        condition=alert.condition,
        threshold=alert.threshold,
        recipients=alert.recipients,
        subject=alert.subject,
        message=alert.message,
        check_interval_minutes=alert.check_interval_minutes,
        cooldown_hours=alert.cooldown_hours,
        enabled=bool(alert.enabled),
        last_checked_at=_isoformat(alert.last_checked_at),
        last_triggered_at=_isoformat(alert.last_triggered_at),
        last_value=alert.last_value,
        last_status=alert.last_status,
        last_message=alert.last_message,
        created_at=_isoformat(alert.created_at),
    )


def _get_alert(db: Session, workspace_id: int, alert_id: int) -> ReportAlert:
    alert = db.get(ReportAlert, alert_id)
    report = db.get(Report, alert.report_id) if alert else None
    if alert is None or report is None or report.collection_id != workspace_id:
        raise HTTPException(status_code=404, detail="Alerta nao encontrado")
    return alert


@router.get("/reports/{report_id}/alerts", response_model=list[AlertOut])
def list_report_alerts(
    workspace_id: int, report_id: int, db: Session = Depends(get_db), _: User = Depends(can_manage)
):
    report = embed_router._get_report_or_404(db, workspace_id, report_id)
    alerts = db.query(ReportAlert).filter(ReportAlert.report_id == report.id).order_by(ReportAlert.id).all()
    return [_out(db, a) for a in alerts]


@router.get("/reports/{report_id}/measures", response_model=list[MeasureOut])
def list_report_measures(
    workspace_id: int, report_id: int, db: Session = Depends(get_db), _: User = Depends(can_manage)
):
    """Lista as medidas disponiveis no dataset do relatorio (via INFO.MEASURES() do Power BI)."""
    report = embed_router._get_report_or_404(db, workspace_id, report_id)
    connection = embed_router._get_connection_or_error(db, report)
    conn_snap = embed_router._connection_snapshot(connection)
    try:
        details = powerbi.get_report_details(conn_snap, report.pbi_workspace_id, report.pbi_report_id)
        dataset_id = details.get("datasetId")
    except powerbi.PowerBIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not dataset_id:
        raise HTTPException(status_code=400, detail="Dataset ID nao encontrado para este relatorio.")
    try:
        measures = powerbi.list_measures(conn_snap, report.pbi_workspace_id, dataset_id)
    except powerbi.PowerBIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [MeasureOut(measure_name=m["measure_name"], table_name=m["table_name"]) for m in measures]


@router.post("/reports/{report_id}/alerts", response_model=AlertOut, status_code=201)
def create_alert(
    workspace_id: int,
    report_id: int,
    data: AlertCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_manage),
):
    report = embed_router._get_report_or_404(db, workspace_id, report_id)
    if db.query(ReportAlert).filter(ReportAlert.report_id == report.id).count() >= MAX_PER_REPORT:
        raise HTTPException(status_code=400, detail=f"Cada relatorio pode ter no maximo {MAX_PER_REPORT} alertas.")
    alert = ReportAlert(
        report_id=report.id,
        created_by_id=current_user.id,
        created_by_name=current_user.name,
        name=data.name,
        measure_name=data.measure_name,
        table_name=data.table_name or None,
        condition=data.condition,
        threshold=data.threshold,
        subject=data.subject,
        message=data.message,
        check_interval_minutes=data.check_interval_minutes,
        cooldown_hours=data.cooldown_hours,
        enabled=data.enabled,
    )
    alert.recipients = data.recipients
    db.add(alert)
    db.commit()
    db.refresh(alert)
    log_action(db, action="alert_created", entity="alert", user_id=current_user.id,
               workspace_id=workspace_id, entity_id=str(alert.id),
               details=f"{alert.measure_name} {alert.condition} {alert.threshold:g}")
    return _out(db, alert)


@router.put("/alerts/{alert_id}", response_model=AlertOut)
def update_alert(
    workspace_id: int,
    alert_id: int,
    data: AlertUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_manage),
):
    alert = _get_alert(db, workspace_id, alert_id)
    changes = data.model_dump(exclude_unset=True)
    if "recipients" in changes:
        alert.recipients = changes.pop("recipients")
    for field, value in changes.items():
        setattr(alert, field, value)
    db.commit()
    db.refresh(alert)
    log_action(db, action="alert_updated", entity="alert", user_id=current_user.id,
               workspace_id=workspace_id, entity_id=str(alert_id),
               details=", ".join(sorted(changes.keys())))
    return _out(db, alert)


@router.delete("/alerts/{alert_id}", status_code=204)
def delete_alert(
    workspace_id: int, alert_id: int, db: Session = Depends(get_db), current_user: User = Depends(can_manage)
):
    alert = _get_alert(db, workspace_id, alert_id)
    db.delete(alert)
    db.commit()
    log_action(db, action="alert_deleted", entity="alert", user_id=current_user.id,
               workspace_id=workspace_id, entity_id=str(alert_id))
    return Response(status_code=204)

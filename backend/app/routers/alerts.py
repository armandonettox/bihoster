from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.core import powerbi
from app.core.audit import log_action
from app.core.database import get_db
from app.core.access_deps import require_global_permission, require_workspace_permission
from app.core.access_engine import can_in_workspace
from app.core.access_ownership import can_act, require_can_act
from app.models.alert import ALERT_CONDITIONS, ReportAlert
from app.models.report import Report
from app.models.user import User
from app.models.workspace import Workspace
from app.routers import powerbi as embed_router
from app.schemas.alert import AlertCreate, AlertOut, AlertUpdate, MeasureOut

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["alerts"])
# O módulo Alertas: a visão de todas as coleções. Criar, editar e excluir seguem pelas rotas de cada coleção, onde as
# permissões de alerta da coleção (e a regra do que é da própria pessoa) são conferidas.
admin_router = APIRouter(prefix="/alerts", tags=["alerts"])

MAX_PER_REPORT = 20


def _isoformat(dt) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _out(db: Session, alert: ReportAlert, viewer: User | None = None) -> AlertOut:
    report = db.get(Report, alert.report_id)
    workspace = db.get(Workspace, report.collection_id) if report else None
    flags = {}
    if viewer is not None and report is not None:
        flags = {
            "can_edit": can_act(db, viewer, report.collection_id, alert.created_by_id, "alerta.editar"),
            "can_delete": can_act(db, viewer, report.collection_id, alert.created_by_id, "alerta.excluir"),
        }
    return AlertOut(
        **flags,
        created_by_id=alert.created_by_id,
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
    workspace_id: int, report_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_workspace_permission("alerta.ver"))
):
    report = embed_router._get_report_or_404(db, workspace_id, report_id)
    alerts = db.query(ReportAlert).filter(ReportAlert.report_id == report.id).order_by(ReportAlert.id).all()
    # Sem a permissao de ver os de outras pessoas, so os que a propria pessoa criou
    if not can_in_workspace(db, current_user.id, "alerta.ver-outras", workspace_id):
        alerts = [a for a in alerts if a.created_by_id == current_user.id]
    return [_out(db, a, current_user) for a in alerts]


@router.get("/reports/{report_id}/measures", response_model=list[MeasureOut])
def list_report_measures(
    workspace_id: int, report_id: int, db: Session = Depends(get_db), _: User = Depends(require_workspace_permission("alerta.ver"))
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
    current_user: User = Depends(require_workspace_permission("alerta.criar")),
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
    return _out(db, alert, current_user)


@router.put("/alerts/{alert_id}", response_model=AlertOut)
def update_alert(
    workspace_id: int,
    alert_id: int,
    data: AlertUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workspace_permission("alerta.editar")),
):
    alert = _get_alert(db, workspace_id, alert_id)
    require_can_act(db, current_user, workspace_id, alert.created_by_id, "alerta.editar", "Voce so edita os alertas que voce criou.")
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
    return _out(db, alert, current_user)


@router.delete("/alerts/{alert_id}", status_code=204)
def delete_alert(
    workspace_id: int, alert_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_workspace_permission("alerta.excluir"))
):
    alert = _get_alert(db, workspace_id, alert_id)
    require_can_act(db, current_user, workspace_id, alert.created_by_id, "alerta.excluir", "Voce so exclui os alertas que voce criou.")
    db.delete(alert)
    db.commit()
    log_action(db, action="alert_deleted", entity="alert", user_id=current_user.id,
               workspace_id=workspace_id, entity_id=str(alert_id))
    return Response(status_code=204)


@admin_router.get("/", response_model=list[AlertOut])
def list_all_alerts(db: Session = Depends(get_db), current_user: User = Depends(require_global_permission("alerta.todas"))):
    """Todos os alertas do portal, de todas as coleções. `can_edit` e `can_delete` dizem o que quem olha pode fazer com
    cada um (o servidor confere de novo ao editar ou excluir)."""
    alerts = (
        db.query(ReportAlert)
        .join(Report, Report.id == ReportAlert.report_id)
        .order_by(Report.collection_id, ReportAlert.report_id, ReportAlert.id)
        .all()
    )
    return [_out(db, a, current_user) for a in alerts]


@admin_router.get("/reports")
def list_reports_for_new_alert(
    db: Session = Depends(get_db), current_user: User = Depends(require_global_permission("alerta.todas"))
):
    """Os relatórios em que quem olha pode criar um alerta (tem `alerta.criar` na coleção), para escolher onde criar o novo."""
    rows = (
        db.query(Report, Workspace)
        .join(Workspace, Workspace.id == Report.collection_id)
        .order_by(Workspace.name, Report.name)
        .all()
    )
    allowed: dict[int, bool] = {}
    result = []
    for report, workspace in rows:
        if workspace.id not in allowed:
            allowed[workspace.id] = can_in_workspace(db, current_user.id, "alerta.criar", workspace.id)
        if allowed[workspace.id]:
            result.append(
                {
                    "report_id": report.id,
                    "report_name": report.name,
                    "collection_id": workspace.id,
                    "collection_name": workspace.name,
                }
            )
    return result

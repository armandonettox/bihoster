"""Monitor de alertas: verifica periodicamente o valor de medidas do Power BI e envia e-mail
quando a condicao e satisfeita.

O loop roda a cada TICK_SECONDS segundos. Para cada alerta vencido (last_checked_at nulo ou
mais antigo que check_interval_minutes):
1. Consulta o valor atual via DAX (executeQueries).
2. Avalia a condicao contra o threshold.
3. Se satisfeita e o cooldown tiver passado: envia e-mail e registra last_triggered_at.
4. Atualiza last_checked_at, last_value e last_status sempre (mesmo sem disparar).

Nunca dispara duas vezes dentro do cooldown -- mesmo que o valor continue acima do limite."""

import logging
import operator
import threading
from datetime import datetime, timezone
from typing import Callable, Optional

from app.core import powerbi
from app.core.audit import log_action
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.email_sender import EmailError, load_smtp_config
from app.models.alert import ReportAlert
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.settings import AppSettings

logger = logging.getLogger(__name__)

TICK_SECONDS = 60

_stop = threading.Event()
_thread: Optional[threading.Thread] = None

_OPS: dict[str, Callable] = {
    ">": operator.gt,
    "<": operator.lt,
    ">=": operator.ge,
    "<=": operator.le,
    "=": operator.eq,
    "!=": operator.ne,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _condition_met(value: float, condition: str, threshold: float) -> bool:
    op = _OPS.get(condition)
    return bool(op and op(value, threshold))


def _cooldown_ok(alert: ReportAlert, now: datetime) -> bool:
    if alert.last_triggered_at is None:
        return True
    elapsed_hours = (now - _utc(alert.last_triggered_at)).total_seconds() / 3600
    return elapsed_hours >= alert.cooldown_hours


def _due_alerts(db) -> list[ReportAlert]:
    now = _now()
    all_enabled = db.query(ReportAlert).filter(ReportAlert.enabled.is_(True)).all()
    due = []
    for alert in all_enabled:
        if alert.last_checked_at is None:
            due.append(alert)
            continue
        elapsed_min = (now - _utc(alert.last_checked_at)).total_seconds() / 60
        if elapsed_min >= alert.check_interval_minutes:
            due.append(alert)
    return due


def _send_alert_email(smtp, alert: ReportAlert, report_name: str, value: float, company: str) -> None:
    from app.core.email_sender import send_email

    condition_label = {
        ">": "maior que", "<": "menor que", ">=": "maior ou igual a",
        "<=": "menor ou igual a", "=": "igual a", "!=": "diferente de",
    }.get(alert.condition, alert.condition)

    subject = alert.subject or f"[Alerta] {alert.measure_name} {condition_label} {alert.threshold:g} - {report_name}"

    body_lines = [
        f"O alerta configurado para o relatorio '{report_name}' foi disparado.",
        "",
        f"Medida:    {alert.measure_name}",
        f"Valor:     {value:g}",
        f"Condicao:  {condition_label} {alert.threshold:g}",
        "",
    ]
    if alert.message:
        body_lines += [alert.message, ""]
    body_lines.append(f"Alerta configurado por {alert.created_by_name or 'um usuario'} no {company}.")

    send_email(smtp, list(alert.recipients), subject, "\n".join(body_lines))


def check_alert(alert_id: int, session_factory: Callable = SessionLocal) -> None:
    """Checa um alerta: consulta o valor, avalia a condicao e dispara o e-mail se necessario."""
    # Import aqui para evitar ciclo (routers importam este modulo)
    from app.routers import powerbi as embed_router

    db = session_factory()
    try:
        alert = db.get(ReportAlert, alert_id)
        report = db.get(Report, alert.report_id) if alert else None
        if alert is None or report is None:
            return

        row = db.query(AppSettings).filter(AppSettings.id == 1).first()
        company = (row.company_name if row else None) or "BIHoster"
        smtp = load_smtp_config(row)
        now = _now()

        connection = db.get(PowerBIConnection, report.powerbi_connection_id) if report.powerbi_connection_id else None
        if connection is None:
            alert.last_checked_at = now
            alert.last_status = "error"
            alert.last_message = "Relatorio sem conexao com o Power BI."
            db.commit()
            return

        conn_snap = embed_router._connection_snapshot(connection)
        dataset_id = report.pbi_dataset_id if hasattr(report, "pbi_dataset_id") else None

        if not dataset_id:
            # Busca o dataset_id via API do Power BI (relatorios guardam o workspace e report id)
            try:
                details = powerbi.get_report_details(conn_snap, report.pbi_workspace_id, report.pbi_report_id)
                dataset_id = details.get("datasetId")
            except powerbi.PowerBIError as exc:
                alert.last_checked_at = now
                alert.last_status = "error"
                alert.last_message = f"Falha ao buscar dataset: {exc}"[:300]
                db.commit()
                return

        if not dataset_id:
            alert.last_checked_at = now
            alert.last_status = "error"
            alert.last_message = "Dataset ID nao encontrado para este relatorio."
            db.commit()
            return

        # Consulta o valor atual da medida
        try:
            value = powerbi.query_measure_value(conn_snap, report.pbi_workspace_id, dataset_id, alert.dax_expression)
        except powerbi.PowerBIError as exc:
            alert.last_checked_at = now
            alert.last_status = "error"
            alert.last_message = f"Falha ao consultar medida: {exc}"[:300]
            db.commit()
            return

        if value is None:
            alert.last_checked_at = now
            alert.last_status = "error"
            alert.last_message = "A medida retornou nulo ou valor nao numerico."
            db.commit()
            return

        alert.last_checked_at = now
        alert.last_value = value
        triggered = _condition_met(value, alert.condition, alert.threshold)

        if triggered and _cooldown_ok(alert, now):
            alert.last_triggered_at = now
            alert.last_status = "triggered"
            alert.last_message = f"Valor {value:g} satisfaz {alert.condition} {alert.threshold:g}."[:300]
            db.commit()

            if smtp and alert.recipients:
                try:
                    _send_alert_email(smtp, alert, report.name, value, company)
                except (EmailError, Exception):  # noqa: BLE001
                    logger.exception("falha ao enviar e-mail do alerta %s", alert_id)
            else:
                logger.warning("alerta %s disparado mas sem SMTP ou destinatarios configurados", alert_id)

            log_action(db, action="alert_triggered", entity="alert", user_id=None,
                       workspace_id=report.collection_id, entity_id=str(alert_id),
                       details=f"medida={alert.measure_name}, valor={value:g}, condicao={alert.condition} {alert.threshold:g}")
        else:
            alert.last_status = "ok"
            alert.last_message = None
            db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("falha inesperada ao checar alerta %s", alert_id)
    finally:
        db.close()


def process_due(session_factory: Callable = SessionLocal) -> int:
    """Checa todos os alertas vencidos. Devolve a quantidade iniciada."""
    db = session_factory()
    try:
        due = _due_alerts(db)
        ids = [a.id for a in due]
    finally:
        db.close()

    for alert_id in ids:
        try:
            check_alert(alert_id, session_factory)
        except Exception:  # noqa: BLE001
            logger.exception("falha ao processar alerta %s", alert_id)
    return len(ids)


def _loop() -> None:
    while not _stop.is_set():
        try:
            process_due()
        except Exception:  # noqa: BLE001
            logger.exception("falha no ciclo do monitor de alertas")
        _stop.wait(TICK_SECONDS)


def start() -> None:
    global _thread
    if not getattr(settings, "subscriptions_enabled", True):
        return
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="alert-monitor", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()

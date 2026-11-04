"""Motor das assinaturas de relatorio.

Uma tarefa em segundo plano (so uma, porque o backend roda com um unico worker) olha de 30 em 30
segundos quais assinaturas venceram. Para cada uma:

1. AVANCA o proximo horario e grava, ANTES de enviar. Assim um horario nunca dispara duas vezes, nem
   se o servidor reiniciar no meio do envio. O preco: se cair exatamente nesse intervalo, aquele
   envio se perde (fica no historico como erro). Perder um e melhor que mandar dado em duplicidade.
2. Horario que ja passou ha mais de MISSED_GRACE (servidor desligado, deploy demorado) NAO e enviado:
   um relatorio das 08:00 chegando as 14:00 confunde mais do que ajuda. Fica no historico como "skipped".
3. Exporta e envia (ate MAX_ATTEMPTS tentativas nos envios agendados), registra o resultado e, depois
   de PAUSE_AFTER_FAILURES falhas seguidas, pausa a assinatura e avisa quem criou.

Antes de cada envio as regras sao conferidas DE NOVO (e-mail configurado, dominios permitidos, relatorio
sem RLS): o que valia quando a assinatura foi criada pode ter mudado."""

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from app.core import powerbi, report_delivery
from app.core import subscription_schedule as sched
from app.core.audit import log_action
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.email_sender import EmailError, disallowed_recipients, load_smtp_config, send_email
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.settings import AppSettings
from app.models.subscription import ReportSubscription, SubscriptionRun
from app.models.user import User

logger = logging.getLogger(__name__)

TICK_SECONDS = 30
# Um horario que passou ha mais que isso nao e mais enviado
MISSED_GRACE = timedelta(minutes=30)
MAX_ATTEMPTS = 3
RETRY_DELAYS_SECONDS = (60, 180)
PAUSE_AFTER_FAILURES = 3

_in_flight: set[int] = set()
_lock = threading.Lock()
_stop = threading.Event()
_thread: Optional[threading.Thread] = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def schedule_next(sub: ReportSubscription, after: datetime) -> None:
    """Recalcula o proximo envio da assinatura a partir de `after` (None se nao houver mais)."""
    sub.next_run_at = sched.next_run_after(sub.days, sub.times, sub.timezone, after, sub.start_date, sub.end_date)


def _record(db, sub: ReportSubscription, *, started, finished, status, trigger, attempts, message) -> None:
    db.add(
        SubscriptionRun(
            subscription_id=sub.id,
            started_at=started,
            finished_at=finished,
            status=status,
            trigger=trigger,
            attempts=attempts,
            message=(message or "")[:300],
            recipients_count=len(sub.recipients),
        )
    )


def process_due(
    session_factory: Callable = SessionLocal,
    now: Optional[datetime] = None,
    start: Optional[Callable[[int, str], object]] = None,
) -> dict:
    """Um ciclo do agendador: acha as vencidas, avanca o proximo horario de cada uma e dispara as que
    devem enviar. Devolve a contagem (iniciadas, perdidas, em andamento) pra log e testes."""
    now = _utc(now) if now else _now()
    start = start or start_run_thread
    counts = {"iniciadas": 0, "perdidas": 0, "em_andamento": 0}
    to_start: list[int] = []

    db = session_factory()
    try:
        due = (
            db.query(ReportSubscription)
            .filter(
                ReportSubscription.enabled.is_(True),
                ReportSubscription.next_run_at.isnot(None),
                ReportSubscription.next_run_at <= now,
            )
            .all()
        )
        for sub in due:
            due_at = _utc(sub.next_run_at)
            # Proximo horario DEPOIS de agora: horarios perdidos no meio do caminho nao viram uma fila de envios
            schedule_next(sub, now)
            if now - due_at > MISSED_GRACE:
                sub.last_status = "skipped"
                sub.last_message = "Horario perdido: o servidor estava desligado ou ocupado."
                _record(db, sub, started=now, finished=now, status="skipped", trigger="schedule", attempts=0, message=sub.last_message)
                counts["perdidas"] += 1
            elif sub.id in _in_flight:
                _record(db, sub, started=now, finished=now, status="skipped", trigger="schedule", attempts=0, message="Envio anterior ainda em andamento.")
                counts["em_andamento"] += 1
            else:
                to_start.append(sub.id)
        db.commit()  # o proximo horario fica gravado ANTES de qualquer envio
    finally:
        db.close()

    for sub_id in to_start:
        start(sub_id, "schedule")
        counts["iniciadas"] += 1
    return counts


class _Plan:
    """O que a thread de envio precisa, copiado do banco (ela nao usa a sessao de ninguem)."""

    def __init__(self, **kwargs):
        self.error: Optional[str] = None
        self.permanent = False
        self.__dict__.update(kwargs)


def _prepare(session_factory: Callable, sub_id: int) -> Optional[_Plan]:
    # Import aqui: o roteador de Power BI importa este pacote, e o contrario criaria um ciclo
    from app.routers import powerbi as embed_router

    db = session_factory()
    try:
        sub = db.get(ReportSubscription, sub_id)
        report = db.get(Report, sub.report_id) if sub else None
        if sub is None or report is None:
            return None
        row = db.query(AppSettings).filter(AppSettings.id == 1).first()
        creator = db.get(User, sub.created_by_id) if sub.created_by_id else None
        company = (row.company_name if row else None) or "BIHoster"
        creator_name = sub.created_by_name or "um usuario"
        footer = f"Envio automatico programado por {creator_name}. Para alterar ou parar de receber, fale com essa pessoa."
        body = f"Segue em anexo o relatorio {report.name}."
        if sub.message:
            body += f"\n\n{sub.message}"
        plan = _Plan(
            sub_id=sub.id,
            workspace_id=report.collection_id,
            report_id=report.id,
            user_id=sub.created_by_id or 0,
            creator_email=creator.email if creator else None,
            creator_name=creator_name,
            report_name=report.name,
            fmt=sub.fmt,
            recipients=sub.recipients,
            subject=sub.subject or f"{company} - {report.name}",
            body=f"{body}\n\n{footer}",
            page_names=report.pbi_page_names,
            pbi_workspace_id=report.pbi_workspace_id,
            pbi_report_id=report.pbi_report_id,
            smtp=load_smtp_config(row),
            connection=None,
        )
        if plan.smtp is None:
            plan.error = "O servidor de e-mail nao esta configurado."
            return plan
        if disallowed_recipients(row, plan.recipients):
            plan.error = "Ha destinatario fora dos dominios permitidos (a lista de dominios mudou depois da criacao)."
            plan.permanent = True
            return plan
        connection = db.get(PowerBIConnection, report.powerbi_connection_id) if report.powerbi_connection_id else None
        if connection is None:
            plan.error = "O relatorio ficou sem uma conta do Power BI."
            plan.permanent = True
            return plan
        plan.connection = embed_router._connection_snapshot(connection)
        try:
            static = embed_router.get_report_static_fresh(plan.connection, report.collection_id, report)
        except powerbi.PowerBIError as exc:
            plan.error = f"Nao foi possivel consultar o Power BI: {exc}"
            return plan
        if static["needs_identity"]:
            plan.error = "O relatorio passou a ter seguranca por linha (RLS), que ainda nao pode ser enviada por e-mail."
            plan.permanent = True
        return plan
    finally:
        db.close()


def _finish(session_factory: Callable, plan: _Plan, *, ok: bool, message: str, attempts: int, started, finished, trigger: str) -> bool:
    """Grava o historico e o estado da assinatura. Devolve True se ela foi pausada agora."""
    paused = False
    db = session_factory()
    try:
        sub = db.get(ReportSubscription, plan.sub_id)
        if sub is None:  # apagada enquanto enviava
            return False
        _record(db, sub, started=started, finished=finished, status="ok" if ok else "error", trigger=trigger, attempts=attempts, message=message)
        sub.last_run_at = finished
        sub.last_status = "ok" if ok else "error"
        sub.last_message = message[:300]
        # So os envios agendados contam pra pausa: um teste manual que falha nao derruba a assinatura
        if trigger == "schedule":
            if ok:
                sub.consecutive_failures = 0
            else:
                sub.consecutive_failures += 1
                if plan.permanent or sub.consecutive_failures >= PAUSE_AFTER_FAILURES:
                    sub.enabled = False
                    sub.next_run_at = None
                    paused = True
        details = f"{plan.fmt}, {len(plan.recipients)} destinatario(s)"  # so a contagem, nunca os enderecos
        if paused:
            action, details = "subscription_paused", f"{details}: {message}"[:300]
        else:
            action = "subscription_sent" if ok else "subscription_failed"
            if not ok:
                details = f"{details}: {message}"[:300]
        db.commit()
        log_action(db, action=action, entity="subscription", user_id=None, workspace_id=plan.workspace_id, entity_id=str(plan.sub_id), details=details)
    finally:
        db.close()
    return paused


def _notify_paused(plan: _Plan, reason: str) -> None:
    """Avisa por e-mail quem criou a assinatura que ela foi pausada. Melhor esforco: nunca levanta."""
    if not plan.creator_email or plan.smtp is None:
        return
    try:
        send_email(
            plan.smtp,
            [plan.creator_email],
            f"Assinatura pausada: {plan.report_name}",
            f"A assinatura do relatorio {plan.report_name} foi pausada.\n\nMotivo: {reason}\n\n"
            "Corrija o problema e ative a assinatura de novo na tela do relatorio.",
        )
    except (EmailError, Exception):  # noqa: BLE001 -- o aviso e um extra, nao pode derrubar o resto
        logger.warning("nao foi possivel avisar o criador da assinatura %s", plan.sub_id)


def run_subscription(
    sub_id: int,
    trigger: str,
    *,
    session_factory: Callable = SessionLocal,
    job: Optional[report_delivery.DeliveryJob] = None,
    deliver: Optional[Callable] = None,
    sleep: Callable[[float], None] = time.sleep,
    now_fn: Callable[[], datetime] = _now,
) -> bool:
    """Envia a assinatura agora (agendada ou manual). Devolve False se ja ha um envio dela em andamento."""
    deliver = deliver or report_delivery.run_delivery
    with _lock:
        if sub_id in _in_flight:
            return False
        _in_flight.add(sub_id)
    try:
        plan = _prepare(session_factory, sub_id)
        if plan is None:
            return True
        started = now_fn()
        ok, message, attempts = False, plan.error or "", 0
        if plan.error is None:
            # Envio manual: uma tentativa so (a pessoa esta olhando); agendado: tenta de novo se falhar
            max_attempts = MAX_ATTEMPTS if trigger == "schedule" else 1
            while attempts < max_attempts:
                attempts += 1
                attempt_job = job or report_delivery.create_job(plan.user_id)
                deliver(
                    job=attempt_job,
                    connection=plan.connection,
                    pbi_workspace_id=plan.pbi_workspace_id,
                    pbi_report_id=plan.pbi_report_id,
                    page_names=plan.page_names,
                    fmt=plan.fmt,
                    report_name=plan.report_name,
                    smtp=plan.smtp,
                    recipients=plan.recipients,
                    subject=plan.subject,
                    body=plan.body,
                )
                if attempt_job.status == "done":
                    ok, message = True, attempt_job.message
                    break
                message = attempt_job.message
                if attempts < max_attempts:
                    sleep(RETRY_DELAYS_SECONDS[min(attempts - 1, len(RETRY_DELAYS_SECONDS) - 1)])
        elif job is not None:
            job.status, job.message = "error", plan.error
        paused = _finish(
            session_factory, plan, ok=ok, message=message, attempts=attempts, started=started, finished=now_fn(), trigger=trigger
        )
        if paused:
            _notify_paused(plan, message)
        return True
    except Exception:  # noqa: BLE001 -- a thread nunca pode morrer sem deixar rastro
        logger.exception("falha inesperada na assinatura %s", sub_id)
        if job is not None and not job.finished:
            job.status, job.message = "error", "Erro inesperado ao enviar a assinatura."
        return True
    finally:
        with _lock:
            _in_flight.discard(sub_id)


def is_running(sub_id: int) -> bool:
    with _lock:
        return sub_id in _in_flight


def start_run_thread(sub_id: int, trigger: str, **kwargs) -> threading.Thread:
    thread = threading.Thread(
        target=run_subscription, args=(sub_id, trigger), kwargs=kwargs, name=f"subscription-{sub_id}", daemon=True
    )
    thread.start()
    return thread


def _loop() -> None:
    while not _stop.is_set():
        try:
            process_due()
        except Exception:  # noqa: BLE001 -- um ciclo ruim nao pode matar o agendador
            logger.exception("falha no ciclo do agendador de assinaturas")
        _stop.wait(TICK_SECONDS)


def start() -> None:
    """Liga o agendador (uma instancia so), se estiver habilitado."""
    global _thread
    if not settings.subscriptions_enabled or (_thread is not None and _thread.is_alive()):
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="subscription-scheduler", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()

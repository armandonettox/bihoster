from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.core import report_delivery, subscription_runner
from app.core import subscription_schedule as sched
from app.core.audit import log_action
from app.core.database import get_db
from app.core.email_sender import allowed_domains, disallowed_recipients, load_smtp_config
from app.core.rate_limit import limiter
from app.core.workspace_deps import get_effective_role, require_platform_admin, require_workspace_role
from app.models.report import Report
from app.models.settings import AppSettings
from app.models.subscription import ReportSubscription, SubscriptionRun
from app.models.user import User, UserRole
from app.models.workspace import Workspace
from app.routers import powerbi as embed_router
from app.schemas.subscription import (
    RunNowOut,
    SubscriptionCreate,
    SubscriptionOut,
    SubscriptionRunOut,
    SubscriptionUpdate,
)

# Quem cria e administra assinaturas de uma colecao: administradores e editores DELA (quem faz a curadoria).
# Leitor nao tem acesso. Editor so vai alem de uma assinatura se a lista de dominios permitidos existir.
router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["subscriptions"])
admin_router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])

can_manage = require_workspace_role(UserRole.admin, UserRole.editor)

MAX_PER_REPORT = 10
RUNS_SHOWN = 30


def _settings(db: Session) -> Optional[AppSettings]:
    return db.query(AppSettings).filter(AppSettings.id == 1).first()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _out(db: Session, sub: ReportSubscription) -> SubscriptionOut:
    report = db.get(Report, sub.report_id)
    workspace = db.get(Workspace, report.collection_id) if report else None
    return SubscriptionOut(
        id=sub.id,
        report_id=sub.report_id,
        report_name=report.name if report else "(relatorio removido)",
        collection_id=report.collection_id if report else 0,
        collection_name=workspace.name if workspace else None,
        name=sub.name,
        recipients=sub.recipients,
        format=sub.fmt,
        days=sub.days,
        times=sub.times,
        schedule_text=sched.describe(sub.days, sub.times),
        timezone=sub.timezone,
        start_date=sub.start_date,
        end_date=sub.end_date,
        subject=sub.subject,
        message=sub.message,
        enabled=bool(sub.enabled),
        next_run_at=sub.next_run_at,
        last_run_at=sub.last_run_at,
        last_status=sub.last_status,
        last_message=sub.last_message,
        consecutive_failures=sub.consecutive_failures or 0,
        created_by_name=sub.created_by_name,
        created_at=sub.created_at,
    )


def _get_subscription(db: Session, workspace_id: int, subscription_id: int) -> ReportSubscription:
    """A assinatura precisa ser de um relatorio DESTA colecao: senao quem edita uma colecao poderia
    mexer na de outra so trocando o numero no endereco."""
    sub = db.get(ReportSubscription, subscription_id)
    report = db.get(Report, sub.report_id) if sub else None
    if sub is None or report is None or report.collection_id != workspace_id:
        raise HTTPException(status_code=404, detail="Assinatura nao encontrada")
    return sub


def _check_recipients(db: Session, user: User, workspace_id: int, recipients: list[str], row: Optional[AppSettings]) -> None:
    if get_effective_role(db, user.id, workspace_id) != UserRole.admin and not allowed_domains(row):
        raise HTTPException(
            status_code=403,
            detail=(
                "Enquanto a lista de dominios permitidos estiver vazia (Configuracoes > E-mail), "
                "so administradores podem criar ou alterar assinaturas."
            ),
        )
    outside = disallowed_recipients(row, recipients)
    if outside:
        raise HTTPException(status_code=400, detail="Destinatario(s) fora dos dominios permitidos: " + ", ".join(outside))


def _check_report_ready(db: Session, workspace_id: int, report: Report, row: Optional[AppSettings]) -> None:
    if load_smtp_config(row) is None:
        raise HTTPException(status_code=400, detail="Configure o servidor de e-mail antes de criar assinaturas.")
    connection = embed_router._get_connection_or_error(db, report)
    static = embed_router.get_report_static_fresh(embed_router._connection_snapshot(connection), workspace_id, report)
    if static["needs_identity"]:
        raise HTTPException(
            status_code=400,
            detail="Relatorios com seguranca por linha (RLS) ainda nao podem ser enviados por e-mail.",
        )


def _apply_schedule(sub: ReportSubscription) -> None:
    """Recalcula o proximo envio (ou limpa, se a assinatura esta pausada)."""
    if not sub.enabled:
        sub.next_run_at = None
        return
    subscription_runner.schedule_next(sub, _now())
    if sub.next_run_at is None:
        raise HTTPException(status_code=400, detail="O periodo informado ja terminou: nao ha nenhum horario futuro de envio.")


@router.get("/subscriptions", response_model=list[SubscriptionOut])
def list_workspace_subscriptions(workspace_id: int, db: Session = Depends(get_db), _: User = Depends(can_manage)):
    subs = (
        db.query(ReportSubscription)
        .join(Report, Report.id == ReportSubscription.report_id)
        .filter(Report.collection_id == workspace_id)
        .order_by(ReportSubscription.id)
        .all()
    )
    return [_out(db, s) for s in subs]


@router.get("/reports/{report_id}/subscriptions", response_model=list[SubscriptionOut])
def list_report_subscriptions(
    workspace_id: int, report_id: int, db: Session = Depends(get_db), _: User = Depends(can_manage)
):
    report = embed_router._get_report_or_404(db, workspace_id, report_id)
    subs = db.query(ReportSubscription).filter(ReportSubscription.report_id == report.id).order_by(ReportSubscription.id).all()
    return [_out(db, s) for s in subs]


@router.post("/reports/{report_id}/subscriptions", response_model=SubscriptionOut, status_code=201)
def create_subscription(
    workspace_id: int,
    report_id: int,
    data: SubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_manage),
):
    report = embed_router._get_report_or_404(db, workspace_id, report_id)
    row = _settings(db)
    _check_recipients(db, current_user, workspace_id, data.recipients, row)
    _check_report_ready(db, workspace_id, report, row)
    if db.query(ReportSubscription).filter(ReportSubscription.report_id == report.id).count() >= MAX_PER_REPORT:
        raise HTTPException(status_code=400, detail=f"Cada relatorio pode ter no maximo {MAX_PER_REPORT} assinaturas.")

    sub = ReportSubscription(
        report_id=report.id,
        created_by_id=current_user.id,
        created_by_name=current_user.name,
        name=data.name,
        fmt=data.format,
        timezone=data.timezone or (row.timezone if row else None) or "America/Sao_Paulo",
        start_date=data.start_date,
        end_date=data.end_date,
        subject=data.subject,
        message=data.message,
        enabled=data.enabled,
        consecutive_failures=0,
    )
    sub.recipients, sub.days, sub.times = data.recipients, data.days, data.times
    _apply_schedule(sub)
    db.add(sub)
    db.commit()
    db.refresh(sub)

    log_action(
        db, action="subscription_created", entity="subscription", user_id=current_user.id, workspace_id=workspace_id,
        entity_id=str(sub.id), details=f"{sub.fmt}, {len(sub.recipients)} destinatario(s), {sched.describe(sub.days, sub.times)}",
    )
    return _out(db, sub)


@router.get("/subscriptions/{subscription_id}", response_model=SubscriptionOut)
def get_subscription(workspace_id: int, subscription_id: int, db: Session = Depends(get_db), _: User = Depends(can_manage)):
    return _out(db, _get_subscription(db, workspace_id, subscription_id))


@router.put("/subscriptions/{subscription_id}", response_model=SubscriptionOut)
def update_subscription(
    workspace_id: int,
    subscription_id: int,
    data: SubscriptionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_manage),
):
    sub = _get_subscription(db, workspace_id, subscription_id)
    changes = data.model_dump(exclude_unset=True)
    row = _settings(db)

    # Editor so mexe se a lista de dominios existir, mesmo sem trocar os destinatarios
    _check_recipients(db, current_user, workspace_id, changes.get("recipients", sub.recipients), row)

    was_enabled = bool(sub.enabled)
    if "recipients" in changes:
        sub.recipients = changes["recipients"]
    if "days" in changes:
        sub.days = changes["days"]
    if "times" in changes:
        sub.times = changes["times"]
    if "format" in changes:
        sub.fmt = changes["format"]
    for field in ("name", "timezone", "start_date", "end_date", "subject", "message", "enabled"):
        if field in changes:
            setattr(sub, field, changes[field])
    try:
        sched.validate_period(sub.start_date, sub.end_date)
    except sched.ScheduleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

    if sub.enabled and not was_enabled:
        _check_report_ready(db, workspace_id, db.get(Report, sub.report_id), row)  # reativar exige tudo em ordem
        sub.consecutive_failures = 0
    _apply_schedule(sub)
    db.commit()
    db.refresh(sub)

    log_action(
        db, action="subscription_updated", entity="subscription", user_id=current_user.id, workspace_id=workspace_id,
        entity_id=str(sub.id), details=", ".join(sorted(changes.keys())),  # so os nomes dos campos
    )
    return _out(db, sub)


@router.delete("/subscriptions/{subscription_id}", status_code=204)
def delete_subscription(
    workspace_id: int, subscription_id: int, db: Session = Depends(get_db), current_user: User = Depends(can_manage)
):
    sub = _get_subscription(db, workspace_id, subscription_id)
    sub_id = sub.id
    db.query(SubscriptionRun).filter(SubscriptionRun.subscription_id == sub_id).delete(synchronize_session=False)
    db.delete(sub)
    db.commit()
    log_action(
        db, action="subscription_deleted", entity="subscription", user_id=current_user.id, workspace_id=workspace_id,
        entity_id=str(sub_id),
    )
    return Response(status_code=204)


@router.post("/subscriptions/{subscription_id}/run", response_model=RunNowOut, status_code=202)
@limiter.limit("5/minute")
def run_subscription_now(
    request: Request,
    workspace_id: int,
    subscription_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_manage),
):
    """Envia agora, fora da agenda (o proximo horario agendado nao muda). O andamento sai em
    /powerbi/export-jobs/{job_id}, o mesmo acompanhamento do envio avulso."""
    sub = _get_subscription(db, workspace_id, subscription_id)
    _check_recipients(db, current_user, workspace_id, sub.recipients, _settings(db))
    if subscription_runner.is_running(sub.id):
        raise HTTPException(status_code=409, detail="Essa assinatura ja esta sendo enviada. Aguarde terminar.")

    user_id, sub_id = current_user.id, sub.id  # valores simples: a thread nao pode tocar em objetos da sessao
    job = report_delivery.create_job(user_id)
    subscription_runner.start_run_thread(sub_id, "manual", job=job)
    log_action(
        db, action="subscription_run_requested", entity="subscription", user_id=user_id, workspace_id=workspace_id,
        entity_id=str(sub_id),
    )
    return RunNowOut(job_id=job.id)


@router.get("/subscriptions/{subscription_id}/runs", response_model=list[SubscriptionRunOut])
def list_runs(workspace_id: int, subscription_id: int, db: Session = Depends(get_db), _: User = Depends(can_manage)):
    sub = _get_subscription(db, workspace_id, subscription_id)
    return (
        db.query(SubscriptionRun)
        .filter(SubscriptionRun.subscription_id == sub.id)
        .order_by(SubscriptionRun.id.desc())
        .limit(RUNS_SHOWN)
        .all()
    )


@admin_router.get("/", response_model=list[SubscriptionOut])
def list_all_subscriptions(db: Session = Depends(get_db), _: User = Depends(require_platform_admin)):
    """Visao do administrador: todas as assinaturas do sistema, de todas as colecoes."""
    return [_out(db, s) for s in db.query(ReportSubscription).order_by(ReportSubscription.id).all()]

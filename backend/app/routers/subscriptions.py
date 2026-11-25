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
from app.core.access_deps import DENIED_WORKSPACE, require_global_permission, require_report_permission, require_workspace_permission
from app.core.access_engine import can_in_workspace
from app.core.access_ownership import can_act, can_in_report, require_can_act
from app.models.report import Report
from app.models.settings import AppSettings
from app.models.subscription import ReportSubscription, SubscriptionRun
from app.models.user import User
from app.models.workspace import Workspace
from app.routers import powerbi as embed_router
from app.routers.auth import get_current_user
from app.schemas.subscription import (
    RunNowOut,
    SubscriptionCreate,
    SubscriptionOut,
    SubscriptionRunOut,
    SubscriptionUpdate,
)

# Cada acao tem o seu item de permissao na colecao (assinatura.ver, criar, editar, excluir, executar). Os atalhos Editor e
# Administrador ligam todos; Leitor nao tem nenhum. Sem o item "qualquer dominio", so da para assinar se a lista de
# dominios permitidos existir.
router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["subscriptions"])
admin_router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])

MAX_PER_REPORT = 10
RUNS_SHOWN = 30


def _settings(db: Session) -> Optional[AppSettings]:
    return db.query(AppSettings).filter(AppSettings.id == 1).first()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _out(db: Session, sub: ReportSubscription, viewer: Optional[User] = None) -> SubscriptionOut:
    report = db.get(Report, sub.report_id)
    workspace = db.get(Workspace, report.collection_id) if report else None
    flags = {}
    if viewer is not None and report is not None:
        ws = report.collection_id
        flags = {
            "can_edit": can_act(db, viewer, ws, sub.created_by_id, "assinatura.editar", report),
            "can_delete": can_act(db, viewer, ws, sub.created_by_id, "assinatura.excluir", report),
            "can_run": can_act(db, viewer, ws, sub.created_by_id, "assinatura.executar", report),
        }
    return SubscriptionOut(
        **flags,
        created_by_id=sub.created_by_id,
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
        page_names=sub.page_names,
        enabled=bool(sub.enabled),
        next_run_at=sub.next_run_at,
        last_run_at=sub.last_run_at,
        last_status=sub.last_status,
        last_message=sub.last_message,
        consecutive_failures=sub.consecutive_failures or 0,
        created_by_name=sub.created_by_name,
        created_at=sub.created_at,
    )


def _get_subscription(db: Session, workspace_id: int, subscription_id: int, user: Optional[User] = None, key: Optional[str] = None) -> ReportSubscription:
    """A assinatura precisa ser de um relatorio DESTA colecao: senao quem edita uma colecao poderia
    mexer na de outra so trocando o numero no endereco. Com `user` e `key`, confere tambem que a pessoa tem o item NESSE
    relatorio (dado nele, na pasta ou herdado); quem nao tem recebe 403, igual a quem nao tem em nenhum lugar."""
    sub = db.get(ReportSubscription, subscription_id)
    report = db.get(Report, sub.report_id) if sub else None
    if user is not None and key is not None:
        allowed = can_in_workspace(db, user.id, key, workspace_id) or (report is not None and can_in_report(db, user, report, key))
        if not allowed:
            raise HTTPException(status_code=403, detail=DENIED_WORKSPACE)
    if sub is None or report is None or report.collection_id != workspace_id:
        raise HTTPException(status_code=404, detail="Assinatura nao encontrada")
    return sub


def _check_recipients(
    db: Session, user: User, workspace_id: int, recipients: list[str], row: Optional[AppSettings], report: Optional[Report] = None
) -> None:
    any_domain = can_in_report(db, user, report, "assinatura.qualquer-dominio") if report is not None else can_in_workspace(db, user.id, "assinatura.qualquer-dominio", workspace_id)
    if not any_domain and not allowed_domains(row):
        raise HTTPException(
            status_code=403,
            detail=(
                "Enquanto a lista de dominios permitidos estiver vazia (Configuracoes > E-mail), "
                "so quem tem a permissao de enviar para qualquer dominio pode criar ou alterar assinaturas."
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


def _visible(db: Session, user: User, workspace_id: int, subs: list[ReportSubscription]) -> list[ReportSubscription]:
    """Sem a permissao de ver as de outras pessoas NAQUELE relatorio, so as que a propria pessoa criou."""
    reports: dict[int, Optional[Report]] = {}
    result = []
    for sub in subs:
        if sub.report_id not in reports:
            reports[sub.report_id] = db.get(Report, sub.report_id)
        report = reports[sub.report_id]
        if sub.created_by_id == user.id or (report is not None and can_in_report(db, user, report, "assinatura.ver-outras")):
            result.append(sub)
    return result


@router.get("/subscriptions", response_model=list[SubscriptionOut])
def list_workspace_subscriptions(workspace_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_workspace_permission("assinatura.ver"))):
    # Lista da colecao inteira: continua exigindo a colecao (quem so recebeu um relatorio nao enxerga os outros)
    subs = (
        db.query(ReportSubscription)
        .join(Report, Report.id == ReportSubscription.report_id)
        .filter(Report.collection_id == workspace_id)
        .order_by(ReportSubscription.id)
        .all()
    )
    return [_out(db, s, current_user) for s in _visible(db, current_user, workspace_id, subs)]


@router.get("/reports/{report_id}/subscriptions", response_model=list[SubscriptionOut])
def list_report_subscriptions(
    workspace_id: int, report_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_report_permission("assinatura.ver"))
):
    report = embed_router._get_report_or_404(db, workspace_id, report_id)
    subs = db.query(ReportSubscription).filter(ReportSubscription.report_id == report.id).order_by(ReportSubscription.id).all()
    return [_out(db, s, current_user) for s in _visible(db, current_user, workspace_id, subs)]


@router.post("/reports/{report_id}/subscriptions", response_model=SubscriptionOut, status_code=201)
def create_subscription(
    workspace_id: int,
    report_id: int,
    data: SubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_report_permission("assinatura.criar")),
):
    report = embed_router._get_report_or_404(db, workspace_id, report_id)
    row = _settings(db)
    _check_recipients(db, current_user, workspace_id, data.recipients, row, report)
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
    if data.page_names is not None:
        sub.page_names = data.page_names
    _apply_schedule(sub)
    db.add(sub)
    db.commit()
    db.refresh(sub)

    log_action(
        db, action="subscription_created", entity="subscription", user_id=current_user.id, workspace_id=workspace_id,
        entity_id=str(sub.id), details=f"{sub.fmt}, {len(sub.recipients)} destinatario(s), {sched.describe(sub.days, sub.times)}",
    )
    return _out(db, sub, current_user)


@router.get("/subscriptions/{subscription_id}", response_model=SubscriptionOut)
def get_subscription(workspace_id: int, subscription_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sub = _get_subscription(db, workspace_id, subscription_id, current_user, "assinatura.ver")
    require_can_act(db, current_user, workspace_id, sub.created_by_id, "assinatura.ver", "Voce so ve as assinaturas que voce criou.", db.get(Report, sub.report_id))
    return _out(db, sub, current_user)


@router.put("/subscriptions/{subscription_id}", response_model=SubscriptionOut)
def update_subscription(
    workspace_id: int,
    subscription_id: int,
    data: SubscriptionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = _get_subscription(db, workspace_id, subscription_id, current_user, "assinatura.editar")
    report = db.get(Report, sub.report_id)
    require_can_act(db, current_user, workspace_id, sub.created_by_id, "assinatura.editar", "Voce so edita as assinaturas que voce criou.", report)
    changes = data.model_dump(exclude_unset=True)
    row = _settings(db)

    # Editor so mexe se a lista de dominios existir, mesmo sem trocar os destinatarios
    _check_recipients(db, current_user, workspace_id, changes.get("recipients", sub.recipients), row, report)

    was_enabled = bool(sub.enabled)
    if "recipients" in changes:
        sub.recipients = changes["recipients"]
    if "days" in changes:
        sub.days = changes["days"]
    if "times" in changes:
        sub.times = changes["times"]
    if "format" in changes:
        sub.fmt = changes["format"]
    if "page_names" in changes:
        sub.page_names = changes["page_names"] or []
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
    return _out(db, sub, current_user)


@router.delete("/subscriptions/{subscription_id}", status_code=204)
def delete_subscription(
    workspace_id: int, subscription_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    sub = _get_subscription(db, workspace_id, subscription_id, current_user, "assinatura.excluir")
    require_can_act(db, current_user, workspace_id, sub.created_by_id, "assinatura.excluir", "Voce so exclui as assinaturas que voce criou.", db.get(Report, sub.report_id))
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
    current_user: User = Depends(get_current_user),
):
    """Envia agora, fora da agenda (o proximo horario agendado nao muda). O andamento sai em
    /powerbi/export-jobs/{job_id}, o mesmo acompanhamento do envio avulso."""
    sub = _get_subscription(db, workspace_id, subscription_id, current_user, "assinatura.executar")
    report = db.get(Report, sub.report_id)
    require_can_act(db, current_user, workspace_id, sub.created_by_id, "assinatura.executar", "Voce so envia agora as assinaturas que voce criou.", report)
    _check_recipients(db, current_user, workspace_id, sub.recipients, _settings(db), report)
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
def list_runs(workspace_id: int, subscription_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sub = _get_subscription(db, workspace_id, subscription_id, current_user, "assinatura.ver")
    require_can_act(db, current_user, workspace_id, sub.created_by_id, "assinatura.ver", "Voce so ve as assinaturas que voce criou.", db.get(Report, sub.report_id))
    return (
        db.query(SubscriptionRun)
        .filter(SubscriptionRun.subscription_id == sub.id)
        .order_by(SubscriptionRun.id.desc())
        .limit(RUNS_SHOWN)
        .all()
    )


@admin_router.get("/", response_model=list[SubscriptionOut])
def list_all_subscriptions(
    db: Session = Depends(get_db), current_user: User = Depends(require_global_permission("assinatura.todas"))
):
    """Visao do administrador: todas as assinaturas do sistema, de todas as colecoes. `can_edit`, `can_delete` e `can_run`
    dizem o que quem olha pode fazer com cada uma (o servidor confere de novo ao editar, excluir ou enviar)."""
    return [
        _out(db, s, current_user)
        for s in db.query(ReportSubscription)
        .join(Report, Report.id == ReportSubscription.report_id)
        .order_by(Report.collection_id, ReportSubscription.report_id, ReportSubscription.id)
        .all()
    ]


@admin_router.get("/reports")
def list_reports_for_new_subscription(
    db: Session = Depends(get_db), current_user: User = Depends(require_global_permission("assinatura.todas"))
):
    """Os relatorios em que quem olha pode criar uma assinatura (tem `assinatura.criar` na colecao), para escolher onde
    criar a nova."""
    rows = (
        db.query(Report, Workspace)
        .join(Workspace, Workspace.id == Report.collection_id)
        .order_by(Workspace.name, Report.name)
        .all()
    )
    result = []
    for report, workspace in rows:
        # Vale o que a pessoa tem NESTE relatorio: dado direto nele, vindo da pasta ou herdado
        if can_in_report(db, current_user, report, "assinatura.criar"):
            result.append(
                {
                    "report_id": report.id,
                    "report_name": report.name,
                    "collection_id": workspace.id,
                    "collection_name": workspace.name,
                }
            )
    return result

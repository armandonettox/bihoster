"""Pedidos de mais tempo de acesso: quem esta fora do horario pede, quem tem a permissao de liberar aprova (por um tempo
limitado) ou recusa. Ver core/access_schedule.py para o horario e a liberacao temporaria."""

import logging
from datetime import datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core import access_schedule as schedule
from app.core import account_emails
from app.core.access_deps import require_global_permission
from app.core.access_engine import can_global
from app.core.audit import log_action
from app.core.audit_filters import system_tz
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models.access_extension import (
    STATUS_APPROVED,
    STATUS_DENIED,
    STATUS_PENDING,
    STATUS_REVOKED,
    AccessExtensionRequest,
)
from app.models.settings import AppSettings
from app.models.user import User
from app.routers.auth import get_current_user_any_hours
from app.schemas.types import UtcDatetime

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/access-extensions", tags=["access-extensions"])

RELEASE_KEY = "membros.liberar-horario"
MIN_MINUTES = 15
MAX_MINUTES = 24 * 60  # uma liberacao e temporaria: mais que isso, o certo e mudar o horario ou dar uma excecao individual
RECENT_DAYS = 14
MAX_APPROVERS_NOTIFIED = 20


class RequestIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)

    @field_validator("reason")
    @classmethod
    def strip_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 5:
            raise ValueError("Explique em pelo menos 5 caracteres por que precisa de mais tempo.")
        return value


class ApproveIn(BaseModel):
    minutes: Optional[int] = Field(default=None, ge=MIN_MINUTES, le=MAX_MINUTES)
    until_time: Optional[str] = None  # "HH:MM", no fuso do sistema


class DenyIn(BaseModel):
    note: Optional[str] = Field(default=None, max_length=300)


class RequestOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    reason: str
    status: str
    created_at: Optional[UtcDatetime] = None
    decided_at: Optional[UtcDatetime] = None
    decided_by_name: Optional[str] = None
    note: Optional[str] = None
    grant_until: Optional[UtcDatetime] = None
    # Aprovado e ainda dentro do prazo: a liberacao esta valendo agora
    active: bool = False


class MineOut(BaseModel):
    request: Optional[RequestOut] = None


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _out(db: Session, item: AccessExtensionRequest, now: datetime) -> RequestOut:
    owner = db.get(User, item.user_id)
    until = _aware(item.grant_until)
    return RequestOut(
        id=item.id,
        user_id=item.user_id,
        user_name=owner.name if owner else None,
        user_email=owner.email if owner else None,
        reason=item.reason,
        status=item.status,
        created_at=item.created_at,
        decided_at=item.decided_at,
        decided_by_name=item.decided_by_name,
        note=item.note,
        grant_until=item.grant_until,
        active=item.status == STATUS_APPROVED and until is not None and until > now,
    )


def _notify_approvers(db: Session, requester: User, reason: str) -> None:
    """Avisa por e-mail quem pode liberar, se o e-mail estiver configurado. Falha de envio nunca derruba o pedido."""
    row = db.query(AppSettings).filter(AppSettings.id == 1).first()
    try:
        account_emails.ensure_ready(row)
    except account_emails.AccountEmailError:
        return
    sent = 0
    for candidate in db.query(User).filter(User.id != requester.id).all():
        if sent >= MAX_APPROVERS_NOTIFIED:
            break
        if candidate.is_blocked or not candidate.email or not can_global(db, candidate.id, RELEASE_KEY):
            continue
        try:
            account_emails.send_extension_request_email(db, row, candidate.email, candidate.name, requester.name, reason)
            sent += 1
        except account_emails.AccountEmailError as exc:
            logger.warning("Aviso de pedido de horario nao enviado: %s", exc)


def _notify_requester(db: Session, item: AccessExtensionRequest, approved: bool, until_text: str | None = None) -> None:
    """Conta por e-mail a quem pediu como o pedido ficou, se o e-mail estiver configurado e a conta nao estiver bloqueada.
    Falha de envio nunca desfaz a decisao."""
    owner = db.get(User, item.user_id)
    if owner is None or owner.is_blocked or not owner.email:
        return
    row = db.query(AppSettings).filter(AppSettings.id == 1).first()
    try:
        account_emails.send_extension_decision_email(db, row, owner.email, owner.name, approved, until_text, item.note)
    except account_emails.AccountEmailError as exc:
        logger.warning("Resposta do pedido de horario nao enviada: %s", exc)


@router.get("/mine", response_model=MineOut)
def my_latest_request(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_any_hours)):
    """O pedido mais recente da propria pessoa e como ficou. Funciona fora do horario: e a tela de "fora do horario" que
    pergunta."""
    latest = (
        db.query(AccessExtensionRequest)
        .filter(AccessExtensionRequest.user_id == current_user.id)
        .order_by(AccessExtensionRequest.id.desc())
        .first()
    )
    return MineOut(request=_out(db, latest, schedule.now_utc()) if latest else None)


@router.post("/mine", response_model=RequestOut, status_code=201)
@limiter.limit("10/hour")
def request_more_time(
    request: Request,
    data: RequestIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_any_hours),
):
    """Pede mais tempo. So faz sentido fora do horario; com um pedido ainda aberto, devolve o mesmo (nao cria outro)."""
    if schedule.evaluate_schedule(db, current_user).allowed:
        raise HTTPException(status_code=400, detail="Você está dentro do horário de acesso. Não precisa pedir mais tempo.")

    now = schedule.now_utc()
    pending = (
        db.query(AccessExtensionRequest)
        .filter(AccessExtensionRequest.user_id == current_user.id, AccessExtensionRequest.status == STATUS_PENDING)
        .first()
    )
    if pending:
        return _out(db, pending, now)

    item = AccessExtensionRequest(user_id=current_user.id, reason=data.reason, status=STATUS_PENDING)
    db.add(item)
    db.commit()
    db.refresh(item)
    log_action(db, action="request_extension", entity="user", user_id=current_user.id, entity_id=current_user.id, details=data.reason[:200])
    _notify_approvers(db, current_user, data.reason)
    return _out(db, item, now)


@router.get("/", response_model=list[RequestOut])
def list_requests(db: Session = Depends(get_db), _: User = Depends(require_global_permission(RELEASE_KEY))):
    """Os pedidos abertos e os decididos nos ultimos dias (inclui as liberacoes que ainda estao valendo)."""
    now = schedule.now_utc()
    since = now - timedelta(days=RECENT_DAYS)
    items = (
        db.query(AccessExtensionRequest)
        .filter((AccessExtensionRequest.status == STATUS_PENDING) | (AccessExtensionRequest.created_at >= since))
        .order_by(AccessExtensionRequest.id.desc())
        .limit(100)
        .all()
    )
    return [_out(db, i, now) for i in items]


def _get_item(db: Session, request_id: int) -> AccessExtensionRequest:
    item = db.get(AccessExtensionRequest, request_id)
    if not item:
        raise HTTPException(status_code=404, detail="Pedido nao encontrado")
    return item


def _grant_until(db: Session, data: ApproveIn, now: datetime) -> datetime:
    if (data.minutes is None) == (data.until_time is None):
        raise HTTPException(status_code=400, detail="Escolha por quanto tempo ou até que horas a liberação vale.")
    if data.minutes is not None:
        return now + timedelta(minutes=data.minutes)
    try:
        hours_text, minutes_text = data.until_time.strip().split(":")
        clock = time(int(hours_text), int(minutes_text))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Horário inválido. Use o formato HH:MM.") from None
    tz, _ = system_tz(db)
    local_now = now.astimezone(tz)
    target = datetime.combine(local_now.date(), clock, tzinfo=tz)
    if target <= local_now:
        target += timedelta(days=1)  # esse horario ja passou hoje: vale ate o de amanha
    until = target.astimezone(timezone.utc)
    if until - now < timedelta(minutes=MIN_MINUTES) or until - now > timedelta(minutes=MAX_MINUTES):
        raise HTTPException(status_code=400, detail="A liberação precisa durar entre 15 minutos e 24 horas.")
    return until


@router.post("/{request_id}/approve", response_model=RequestOut)
def approve_request(
    request_id: int,
    data: ApproveIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission(RELEASE_KEY)),
):
    item = _get_item(db, request_id)
    if item.status != STATUS_PENDING:
        raise HTTPException(status_code=409, detail="Esse pedido já foi respondido.")
    if item.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Você não pode liberar o seu próprio acesso. Peça para outra pessoa.")

    now = schedule.now_utc()
    until = _grant_until(db, data, now)
    item.status = STATUS_APPROVED
    item.decided_at = now
    item.decided_by_id = current_user.id
    item.decided_by_name = current_user.name
    item.grant_until = until
    db.commit()
    db.refresh(item)
    owner = db.get(User, item.user_id)
    tz, tz_name = system_tz(db)
    log_action(
        db, action="approve_extension", entity="user", user_id=current_user.id, entity_id=item.user_id,
        details=f"{owner.email if owner else item.user_id} até {until.astimezone(tz).strftime('%d/%m %H:%M')} ({tz_name})",
    )
    _notify_requester(db, item, approved=True, until_text=f"{until.astimezone(tz).strftime('%d/%m às %H:%M')} (horário de {tz_name})")
    return _out(db, item, now)


@router.post("/{request_id}/deny", response_model=RequestOut)
def deny_request(
    request_id: int,
    data: DenyIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission(RELEASE_KEY)),
):
    item = _get_item(db, request_id)
    if item.status != STATUS_PENDING:
        raise HTTPException(status_code=409, detail="Esse pedido já foi respondido.")

    now = schedule.now_utc()
    item.status = STATUS_DENIED
    item.decided_at = now
    item.decided_by_id = current_user.id
    item.decided_by_name = current_user.name
    item.note = (data.note or "").strip() or None
    db.commit()
    db.refresh(item)
    owner = db.get(User, item.user_id)
    log_action(db, action="deny_extension", entity="user", user_id=current_user.id, entity_id=item.user_id, details=owner.email if owner else None)
    _notify_requester(db, item, approved=False)
    return _out(db, item, now)


@router.post("/{request_id}/revoke", response_model=RequestOut)
def revoke_release(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission(RELEASE_KEY)),
):
    """Encerra uma liberacao que ainda esta valendo, antes do prazo."""
    item = _get_item(db, request_id)
    now = schedule.now_utc()
    until = _aware(item.grant_until)
    if item.status != STATUS_APPROVED or until is None or until <= now:
        raise HTTPException(status_code=409, detail="Essa liberação já terminou.")

    item.status = STATUS_REVOKED
    item.grant_until = now
    db.commit()
    db.refresh(item)
    owner = db.get(User, item.user_id)
    log_action(db, action="revoke_extension", entity="user", user_id=current_user.id, entity_id=item.user_id, details=owner.email if owner else None)
    return _out(db, item, now)

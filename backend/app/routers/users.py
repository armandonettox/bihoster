import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import account_emails, chat_history
from app.core.audit import log_action
from app.core.database import get_db
from app.core.access_deps import require_global_permission
from app.core.access_guard import check_can_touch_account
from app.core.rate_limit import limiter
from app.core.workspace_deps import is_platform_admin
from app.models.access_grant import AccessGrant
from app.models.access_extension import AccessExtensionRequest
from app.models.access_schedule import AccessScheduleRange
from app.models.audit_log import AuditLog
from app.models.favorite import Favorite
from app.models.invite import GroupInvite
from app.models.password_reset import PasswordResetToken
from app.models.settings import AppSettings
from app.models.user import User
from app.models.workspace import Group, GroupMember
from app.schemas.user_directory import PendingInviteOut, UserDirectoryOut, UserGroupOut

router = APIRouter(prefix="/users", tags=["users"])

RESET_TOKEN_EXPIRE_MINUTES = 30
BLOCKED_MESSAGE = "Essa pessoa esta bloqueada. Desbloqueie antes de enviar o e-mail."


def _new_reset_token(db: Session, user: User) -> str:
    """Cria o codigo de redefinicao de senha (limpando os usados e vencidos da pessoa) e devolve o texto dele."""
    now = datetime.now(timezone.utc)
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        (PasswordResetToken.used == True) | (PasswordResetToken.expires_at < now),  # noqa: E712
    ).delete(synchronize_session=False)

    token = secrets.token_urlsafe(32)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token=token,
            expires_at=now + timedelta(minutes=RESET_TOKEN_EXPIRE_MINUTES),
        )
    )
    db.commit()
    return token


class WelcomeEmailIn(BaseModel):
    email: EmailStr


def _settings_row(db: Session) -> AppSettings | None:
    return db.query(AppSettings).filter(AppSettings.id == 1).first()


@router.get("/", response_model=list[UserDirectoryOut])
def list_users(db: Session = Depends(get_db), _=Depends(require_global_permission("membros.ver"))):
    users = db.query(User).order_by(User.name).all()
    memberships = (
        db.query(GroupMember, Group)
        .join(Group, Group.id == GroupMember.group_id)
        .all()
    )

    groups_by_user: dict[int, list[UserGroupOut]] = {}
    for member, group in memberships:
        groups_by_user.setdefault(member.user_id, []).append(
            UserGroupOut(id=group.id, name=group.name, is_default=group.is_default, is_admin_group=group.is_admin_group)
        )

    last_login_by_user = dict(
        db.query(AuditLog.user_id, func.max(AuditLog.created_at))
        .filter(AuditLog.action == "login")
        .group_by(AuditLog.user_id)
        .all()
    )

    return [
        UserDirectoryOut(
            id=u.id,
            name=u.name,
            email=u.email,
            groups=groups_by_user.get(u.id, []),
            last_login=last_login_by_user.get(u.id),
            is_blocked=bool(u.is_blocked),
            picture_url=u.picture_url,
        )
        for u in users
    ]


@router.get("/pending-invites", response_model=list[PendingInviteOut])
def list_pending_invites(db: Session = Depends(get_db), _=Depends(require_global_permission("membros.ver"))):
    """Convites de qualquer grupo, para exibir no diretorio global de membros."""
    rows = (
        db.query(GroupInvite, Group.name)
        .join(Group, Group.id == GroupInvite.group_id)
        .order_by(GroupInvite.created_at.desc())
        .all()
    )
    return [
        PendingInviteOut(id=invite.id, email=invite.email, group_id=invite.group_id, group_name=group_name, created_at=invite.created_at)
        for invite, group_name in rows
    ]


@router.post("/{user_id}/reset-link")
def generate_reset_link(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("membros.senha")),
):
    """Gera um token de redefinicao de senha para o admin copiar e enviar manualmente ao usuario."""
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    check_can_touch_account(db, current_user, user_id)

    token = _new_reset_token(db, user)

    log_action(db, action="generate_reset_link", entity="user", user_id=current_user.id, entity_id=user.id)

    return {"token": token, "expires_in_minutes": RESET_TOKEN_EXPIRE_MINUTES}


@router.post("/{user_id}/send-reset-email")
@limiter.limit("20/minute")
def send_reset_email(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("membros.senha")),
):
    """Manda por e-mail, para a propria pessoa, o link para criar uma senha nova. O link vai so para o e-mail dela: quem
    pede o envio nunca o ve."""
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    if user.is_blocked:
        raise HTTPException(status_code=400, detail=BLOCKED_MESSAGE)

    settings_row = _settings_row(db)
    try:
        account_emails.ensure_ready(settings_row)  # confere antes de criar o codigo
        token = _new_reset_token(db, user)
        account_emails.send_reset_email(db, settings_row, user.email, user.name, token, RESET_TOKEN_EXPIRE_MINUTES)
    except account_emails.AccountEmailError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

    log_action(db, action="send_reset_email", entity="user", user_id=current_user.id, entity_id=user.id, details=user.email)
    return {"status": "sent", "email": user.email}


@router.post("/welcome-email")
@limiter.limit("20/minute")
def send_welcome_email(
    request: Request,
    data: WelcomeEmailIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("membros.adicionar")),
):
    """Avisa por e-mail que a pessoa foi adicionada, com o link para entrar. Quem ja tem conta recebe o link de entrada;
    quem so tem convite pendente recebe o link do cadastro."""
    email = data.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if user is None and db.query(GroupInvite.id).filter(GroupInvite.email == email).first() is None:
        raise HTTPException(status_code=404, detail="Nenhum membro ou convite com esse e-mail")
    if user is not None and user.is_blocked:
        raise HTTPException(status_code=400, detail=BLOCKED_MESSAGE)

    try:
        account_emails.send_added_email(db, _settings_row(db), email, user.name if user else None, has_account=user is not None)
    except account_emails.AccountEmailError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

    kind = "added" if user is not None else "invited"
    log_action(db, action="send_welcome_email", entity="user", user_id=current_user.id, entity_id=user.id if user else None, details=f"{email} ({kind})")
    return {"status": "sent", "email": email, "kind": kind}


def _other_active_admins(db: Session, user_id: int) -> int:
    """Quantos administradores da plataforma, alem desta pessoa, ainda podem entrar (nao estao bloqueados)."""
    return (
        db.query(User.id)
        .join(GroupMember, GroupMember.user_id == User.id)
        .join(Group, Group.id == GroupMember.group_id)
        .filter(Group.is_admin_group.is_(True), User.id != user_id, (User.is_blocked.is_(None)) | (User.is_blocked.is_(False)))
        .distinct()
        .count()
    )


@router.post("/{user_id}/block", status_code=204)
def block_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("membros.bloquear")),
):
    """Impede a pessoa de entrar e derruba a sessao que ela tiver aberta, ate alguem desbloquear. Nao apaga nada dela."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Voce nao pode bloquear a propria conta")
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    check_can_touch_account(db, current_user, user_id)
    if user.is_blocked:
        return None
    if is_platform_admin(db, user_id) and _other_active_admins(db, user_id) == 0:
        raise HTTPException(status_code=400, detail="Nao e possivel bloquear o ultimo administrador ativo da plataforma")

    user.is_blocked = True
    db.commit()
    log_action(db, action="block_user", entity="user", user_id=current_user.id, entity_id=user.id, details=user.email)
    return None


@router.post("/{user_id}/unblock", status_code=204)
def unblock_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("membros.bloquear")),
):
    """Devolve o acesso de uma pessoa bloqueada."""
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    check_can_touch_account(db, current_user, user_id)
    if not user.is_blocked:
        return None

    user.is_blocked = False
    db.commit()
    log_action(db, action="unblock_user", entity="user", user_id=current_user.id, entity_id=user.id, details=user.email)
    return None


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("membros.remover")),
):
    """Remove a conta por completo -- grupos, favoritos e tokens de reset do usuario;
    entradas de auditoria e convites que ele criou ficam sem autor (user_id nulo)."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Voce nao pode remover a propria conta")

    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    check_can_touch_account(db, current_user, user_id)

    email = user.email
    db.query(GroupMember).filter(GroupMember.user_id == user_id).delete(synchronize_session=False)
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user_id).delete(synchronize_session=False)
    db.query(Favorite).filter(Favorite.user_id == user_id).delete(synchronize_session=False)
    chat_history.delete_user_history(db, user_id, commit=False)  # historico do chat de IA e dado da pessoa: sai junto
    db.query(GroupInvite).filter(GroupInvite.invited_by_id == user_id).update(
        {"invited_by_id": None}, synchronize_session=False
    )
    # Guarda o email nas linhas de auditoria do usuario (as antigas nao tem) antes de perder o
    # vinculo, pra a autoria continuar visivel na tela de auditoria.
    db.query(AuditLog).filter(AuditLog.user_id == user_id, AuditLog.user_email.is_(None)).update(
        {"user_email": email}, synchronize_session=False
    )
    db.query(AuditLog).filter(AuditLog.user_id == user_id).update({"user_id": None}, synchronize_session=False)
    db.query(AccessGrant).filter(AccessGrant.user_id == user_id).delete(synchronize_session=False)
    db.query(AccessScheduleRange).filter(AccessScheduleRange.user_id == user_id).delete(synchronize_session=False)
    db.query(AccessExtensionRequest).filter(AccessExtensionRequest.user_id == user_id).delete(synchronize_session=False)
    db.query(AccessExtensionRequest).filter(AccessExtensionRequest.decided_by_id == user_id).update(
        {"decided_by_id": None}, synchronize_session=False
    )
    db.delete(user)

    log_action(db, action="delete_user", entity="user", user_id=current_user.id, entity_id=user_id, details=email)

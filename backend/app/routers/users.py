import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.workspace_deps import require_platform_admin
from app.models.audit_log import AuditLog
from app.models.favorite import Favorite
from app.models.invite import GroupInvite
from app.models.password_reset import PasswordResetToken
from app.models.user import User
from app.models.workspace import Group, GroupMember
from app.schemas.user_directory import PendingInviteOut, UserDirectoryOut, UserGroupOut

router = APIRouter(prefix="/users", tags=["users"])

RESET_TOKEN_EXPIRE_MINUTES = 30


@router.get("/", response_model=list[UserDirectoryOut])
def list_users(db: Session = Depends(get_db), _=Depends(require_platform_admin)):
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
        )
        for u in users
    ]


@router.get("/pending-invites", response_model=list[PendingInviteOut])
def list_pending_invites(db: Session = Depends(get_db), _=Depends(require_platform_admin)):
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
    current_user: User = Depends(require_platform_admin),
):
    """Gera um token de redefinicao de senha para o admin copiar e enviar manualmente ao usuario."""
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")

    now = datetime.now(timezone.utc)
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        (PasswordResetToken.used == True) | (PasswordResetToken.expires_at < now),  # noqa: E712
    ).delete(synchronize_session=False)

    token = secrets.token_urlsafe(32)
    reset_token = PasswordResetToken(
        user_id=user.id,
        token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=RESET_TOKEN_EXPIRE_MINUTES),
    )
    db.add(reset_token)
    db.commit()

    log_action(db, action="generate_reset_link", entity="user", user_id=current_user.id, entity_id=user.id)

    return {"token": token, "expires_in_minutes": RESET_TOKEN_EXPIRE_MINUTES}


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    """Remove a conta por completo -- grupos, favoritos e tokens de reset do usuario;
    entradas de auditoria e convites que ele criou ficam sem autor (user_id nulo)."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Voce nao pode remover a propria conta")

    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")

    email = user.email
    db.query(GroupMember).filter(GroupMember.user_id == user_id).delete(synchronize_session=False)
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user_id).delete(synchronize_session=False)
    db.query(Favorite).filter(Favorite.user_id == user_id).delete(synchronize_session=False)
    db.query(GroupInvite).filter(GroupInvite.invited_by_id == user_id).update(
        {"invited_by_id": None}, synchronize_session=False
    )
    db.query(AuditLog).filter(AuditLog.user_id == user_id).update({"user_id": None}, synchronize_session=False)
    db.delete(user)

    log_action(db, action="delete_user", entity="user", user_id=current_user.id, entity_id=user_id, details=email)

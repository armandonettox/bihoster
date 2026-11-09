"""Quem pode gerenciar a IA (chaves e modelos) e quem pode usar o chat.

A permissao vem dos grupos: a pessoa tem uma chave se qualquer grupo dela tiver. Quem e do grupo
Administradores tem todas, sem precisar de linha na tabela. Nao usa o catalogo de niveis por
pessoa de core/permissions.py: o que manda no acesso do projeto sao os grupos."""

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.workspace_deps import is_platform_admin
from app.models.group_permission import GroupPermission
from app.models.user import User
from app.models.workspace import GroupMember
from app.routers.auth import get_current_user

AI_MANAGE = "ia.gerenciar"
AI_USE = "ia.usar"
AI_PERMISSIONS: tuple[str, ...] = (AI_MANAGE, AI_USE)


def ai_permissions(db: Session, user_id: int) -> set[str]:
    """Chaves de IA que a pessoa tem: todas se for administradora, senao a uniao dos grupos dela."""
    if is_platform_admin(db, user_id):
        return set(AI_PERMISSIONS)

    rows = (
        db.query(GroupPermission.permission_key)
        .join(GroupMember, GroupMember.group_id == GroupPermission.group_id)
        .filter(GroupMember.user_id == user_id, GroupPermission.permission_key.in_(AI_PERMISSIONS))
        .distinct()
        .all()
    )
    return {row.permission_key for row in rows}


def require_ai_permission(key: str):
    def dependency(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> User:
        if key not in ai_permissions(db, current_user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Voce nao tem permissao para essa acao de IA.",
            )
        return current_user

    return dependency


require_ai_manage = require_ai_permission(AI_MANAGE)
require_ai_use = require_ai_permission(AI_USE)

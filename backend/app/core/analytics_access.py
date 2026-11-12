"""Quem pode ver, criar, editar e excluir visuais do painel de Analiticos.

Mesma regra da IA (core/ai_access.py): a permissao vem dos grupos, a pessoa tem uma chave se
qualquer grupo dela tiver, e o grupo Administradores tem todas sem precisar de linha na tabela.
Criar, editar e excluir pressupoem ver."""

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permission_keys import (
    ANALYTICS_CREATE,
    ANALYTICS_DELETE,
    ANALYTICS_EDIT,
    ANALYTICS_PERMISSIONS,
    ANALYTICS_VIEW,
    with_implied,
)
from app.core.workspace_deps import is_platform_admin
from app.models.group_permission import GroupPermission
from app.models.user import User
from app.models.workspace import GroupMember
from app.routers.auth import get_current_user


def analytics_permissions(db: Session, user_id: int) -> set[str]:
    """Chaves de analiticos da pessoa: todas se for administradora, senao a uniao dos grupos dela."""
    if is_platform_admin(db, user_id):
        return set(ANALYTICS_PERMISSIONS)

    rows = (
        db.query(GroupPermission.permission_key)
        .join(GroupMember, GroupMember.group_id == GroupPermission.group_id)
        .filter(GroupMember.user_id == user_id, GroupPermission.permission_key.in_(ANALYTICS_PERMISSIONS))
        .distinct()
        .all()
    )
    return set(with_implied({row.permission_key for row in rows}))


def require_analytics_permission(key: str):
    def dependency(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> User:
        if key not in analytics_permissions(db, current_user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Voce nao tem permissao para essa acao nos analiticos.",
            )
        return current_user

    return dependency


require_analytics_view = require_analytics_permission(ANALYTICS_VIEW)

__all__ = [
    "ANALYTICS_CREATE",
    "ANALYTICS_DELETE",
    "ANALYTICS_EDIT",
    "ANALYTICS_VIEW",
    "analytics_permissions",
    "require_analytics_permission",
    "require_analytics_view",
]

"""Quem pode ver, criar, editar e excluir visuais do painel de Analiticos.

A permissao vem das permissoes novas (tabela access_grants): a soma do que vem dos grupos da pessoa com o que foi dado
a ela, e o grupo Administradores tem todas. Criar, editar e excluir pressupoem ver (o catalogo ja exige isso)."""

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permission_keys import (
    ANALYTICS_CREATE,
    ANALYTICS_DELETE,
    ANALYTICS_EDIT,
    ANALYTICS_PERMISSIONS,
    ANALYTICS_VIEW,
)
from app.models.user import User
from app.routers.auth import get_current_user


def analytics_permissions(db: Session, user_id: int) -> set[str]:
    """Chaves de analiticos da pessoa, lidas das permissoes novas."""
    from app.core.access_engine import effective_access  # import aqui para nao fechar um ciclo com o motor

    access = effective_access(db, user_id)
    return {key for key in ANALYTICS_PERMISSIONS if access.has_global(key)}


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

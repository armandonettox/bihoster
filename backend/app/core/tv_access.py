"""Quem pode ver e quem pode modificar cada TV.

Cada TV tem a propria lista de pessoas e grupos (tabela tv_grants). Os niveis sao "ver" (que inclui utilizar: abrir o
link, ver o codigo, desconectar e pre-visualizar) e "modificar" (que inclui ver). O administrador da plataforma e dono
de todas. Criar TV e uma permissao geral do catalogo (`tv.criar`)."""

from typing import Optional

from sqlalchemy.orm import Session

from app.core.access_engine import can_global
from app.core.workspace_deps import is_platform_admin
from app.models.tv import Tv, TvGrant
from app.models.workspace import GroupMember

VIEW = "ver"
MODIFY = "modificar"
LEVELS = (VIEW, MODIFY)
CREATE_KEY = "tv.criar"
_RANK = {VIEW: 1, MODIFY: 2}


def _levels_by_tv(db: Session, user_id: int) -> dict[int, str]:
    rows = (
        db.query(TvGrant.tv_id, TvGrant.level)
        .outerjoin(GroupMember, GroupMember.group_id == TvGrant.group_id)
        .filter((TvGrant.user_id == user_id) | (GroupMember.user_id == user_id))
        .all()
    )
    result: dict[int, str] = {}
    for tv_id, level in rows:
        if _RANK.get(level, 0) > _RANK.get(result.get(tv_id, ""), 0):
            result[tv_id] = level
    return result


def level_in_tv(db: Session, user_id: int, tv_id: int) -> Optional[str]:
    if is_platform_admin(db, user_id):
        return MODIFY
    return _levels_by_tv(db, user_id).get(tv_id)


def levels_for_user(db: Session, user_id: int) -> dict[int, str]:
    """O nivel da pessoa em cada TV que ela enxerga (administrador: modificar em todas)."""
    if is_platform_admin(db, user_id):
        return {row.id: MODIFY for row in db.query(Tv.id).all()}
    return _levels_by_tv(db, user_id)


def can_create(db: Session, user_id: int) -> bool:
    return can_global(db, user_id, CREATE_KEY)


def has_any_access(db: Session, user_id: int) -> bool:
    """Mostra o modulo Modo TV: quem cria TVs ou tem acesso a alguma."""
    return can_create(db, user_id) or bool(levels_for_user(db, user_id))

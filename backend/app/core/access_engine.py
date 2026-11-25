"""Calcula o que uma pessoa pode fazer, juntando grupos e permissoes dadas direto a ela.

Regra unica: permissao da pessoa = tudo que vem dos grupos dela + tudo que foi dado a ela, no escopo
pedido. So soma, nunca nega. Quem e do grupo Administradores tem todas, sem precisar de linhas.
Permissao nenhuma faz alguem virar administrador da plataforma: isso so vem de estar no grupo
Administradores (ver L-314)."""

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.core.access_catalog import (
    COLLECTION_VIEW,
    GLOBAL,
    GLOBAL_KEYS,
    WORKSPACE,
    WORKSPACE_KEYS,
    scope_of,
    with_implied,
)
from app.core.workspace_deps import is_platform_admin
from app.models.access_grant import AccessGrant
from app.models.workspace import GroupMember, Workspace


@dataclass
class EffectiveAccess:
    """Permissoes de uma pessoa: as globais e as de cada colecao (id da colecao para as chaves)."""

    is_admin: bool = False
    global_keys: set[str] = field(default_factory=set)
    by_workspace: dict[int, set[str]] = field(default_factory=dict)

    def has_global(self, key: str) -> bool:
        return self.is_admin or key in self.global_keys

    def has_in_workspace(self, key: str, workspace_id: int) -> bool:
        return self.is_admin or key in self.by_workspace.get(workspace_id, set())

    def workspace_ids_with(self, key: str) -> set[int]:
        return {wid for wid, keys in self.by_workspace.items() if key in keys}


def effective_access(db: Session, user_id: int) -> EffectiveAccess:
    """Todas as permissoes da pessoa, em duas consultas. Administrador recebe tudo."""
    if is_platform_admin(db, user_id):
        # A Raiz (colecao interna do catalogo) nao entra: nao aparece como colecao em nenhuma lista
        workspace_ids = [row.id for row in db.query(Workspace.id).filter(Workspace.system_key.is_(None)).all()]
        return EffectiveAccess(
            is_admin=True,
            global_keys=set(GLOBAL_KEYS),
            by_workspace={wid: set(WORKSPACE_KEYS) for wid in workspace_ids},
        )

    from_groups = (
        db.query(AccessGrant.workspace_id, AccessGrant.permission_key)
        .join(GroupMember, GroupMember.group_id == AccessGrant.group_id)
        .filter(GroupMember.user_id == user_id)
        .all()
    )
    from_user = (
        db.query(AccessGrant.workspace_id, AccessGrant.permission_key)
        .filter(AccessGrant.user_id == user_id)
        .all()
    )

    result = EffectiveAccess()
    raw_global: set[str] = set()
    raw_workspace: dict[int, set[str]] = {}
    for workspace_id, key in [*from_groups, *from_user]:
        scope = scope_of(key)
        if scope == GLOBAL and workspace_id is None:
            raw_global.add(key)
        elif scope == WORKSPACE and workspace_id is not None:
            raw_workspace.setdefault(workspace_id, set()).add(key)
        # linha com escopo trocado (chave de colecao sem colecao, por exemplo) e ignorada

    result.global_keys = set(with_implied(raw_global))
    result.by_workspace = {wid: set(with_implied(keys)) for wid, keys in raw_workspace.items()}
    return result


def can_in_workspace(db: Session, user_id: int, key: str, workspace_id: int) -> bool:
    return effective_access(db, user_id).has_in_workspace(key, workspace_id)


def can_global(db: Session, user_id: int, key: str) -> bool:
    return effective_access(db, user_id).has_global(key)


def can_see_workspace(db: Session, user_id: int, workspace_id: int) -> bool:
    return can_in_workspace(db, user_id, COLLECTION_VIEW, workspace_id)

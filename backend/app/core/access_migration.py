"""Copia os dados do modelo antigo para a tabela access_grants, uma unica vez.

Antes: cada grupo tinha um papel (viewer, editor ou admin) por colecao em GroupWorkspaceAccess, e
permissoes de funcionalidade em GroupPermission. Agora tudo vira linhas de access_grants. As tabelas
antigas ficam intactas ate a etapa de limpeza, para dar para voltar atras.

A permissao antiga "ia.gerenciar" era uma so e cobria varias areas; ao copiar, ela vira todos os itens novos
(chaves, modelos, bloqueios, registro e consumo), para ninguem perder acesso."""

import logging

from sqlalchemy.orm import Session

from app.core.access_catalog import GLOBAL, LEGACY_EXPANSIONS, PRESETS, scope_of, with_implied
from app.models.access_grant import AccessGrant, AccessMigrationMark
from app.models.group_permission import GroupPermission
from app.models.user import UserRole
from app.models.workspace import GroupWorkspaceAccess

logger = logging.getLogger(__name__)

_ROLE_TO_PRESET = {
    UserRole.viewer: "leitor",
    UserRole.editor: "editor",
    UserRole.admin: "administrador",
}


def migrate_legacy_access(db: Session) -> int:
    """Devolve quantas linhas criou. Roda so uma vez: depois a marca impede de repetir."""
    if db.query(AccessMigrationMark).first():
        return 0

    created = 0
    for entry in db.query(GroupWorkspaceAccess).all():
        for key in with_implied(PRESETS[_ROLE_TO_PRESET[entry.role]]):
            db.add(AccessGrant(group_id=entry.group_id, workspace_id=entry.workspace_id, permission_key=key))
            created += 1

    # Uma permissao antiga pode virar varias novas; junta por grupo para nao repetir
    global_by_group: dict[int, set[str]] = {}
    for row in db.query(GroupPermission).all():
        for key in LEGACY_EXPANSIONS.get(row.permission_key, (row.permission_key,)):
            if scope_of(key) == GLOBAL:  # chave que nao existe mais no catalogo fica de fora
                global_by_group.setdefault(row.group_id, set()).add(key)
    for group_id, keys in global_by_group.items():
        for key in with_implied(keys):
            db.add(AccessGrant(group_id=group_id, workspace_id=None, permission_key=key))
            created += 1

    db.add(AccessMigrationMark())
    db.commit()
    logger.warning("Permissoes unificadas: %s linhas copiadas para access_grants", created)
    return created

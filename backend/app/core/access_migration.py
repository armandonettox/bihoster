"""Copia os dados do modelo antigo para a tabela access_grants, uma unica vez.

Antes: cada grupo tinha um papel (viewer, editor ou admin) por colecao em GroupWorkspaceAccess, e
permissoes de funcionalidade em GroupPermission. Agora tudo vira linhas de access_grants. As tabelas
antigas ficam intactas ate a etapa de limpeza, para dar para voltar atras.

A permissao antiga "ia.gerenciar" era uma so e cobria varias areas; ao copiar, ela vira todos os itens novos
(chaves, modelos, bloqueios, registro e consumo), para ninguem perder acesso."""

import logging

from sqlalchemy.orm import Session

from app.core.access_catalog import GLOBAL, LEGACY_EXPANSIONS, OWN_TO_OTHERS, PRESETS, scope_of, with_implied
from app.models.access_grant import AccessGrant, AccessInviteGrant, AccessMigrationMark, AccessMigrationStep
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


OWN_SCOPE_STEP = "assinaturas-e-alertas-de-outras-pessoas"


def migrate_own_scope_split(db: Session) -> int:
    """Assinaturas e alertas passaram a ter permissoes separadas para o que a pessoa criou e para o que outras criaram.
    Antes, quem podia ver, editar, excluir ou enviar agora fazia isso em tudo da colecao. Para ninguem perder acesso,
    quem tinha cada permissao simples ganha a "-outras" equivalente, uma unica vez (a marca impede de repetir, senao
    reiniciar o servidor devolveria o que o administrador tirou depois). Vale para grupos, pessoas e convites pendentes.
    Devolve quantas linhas criou."""
    if db.get(AccessMigrationStep, OWN_SCOPE_STEP):
        return 0

    created = 0
    # So entra a permissao "-outras" equivalente a cada uma que ja tinham, e so se ainda nao tiverem; nada alem disso
    # (nem o que ela exige: quem tinha a simples ja tinha ver a colecao e as outras exigencias)
    held = {(row.group_id, row.user_id, row.workspace_id, row.permission_key) for row in db.query(AccessGrant).all()}
    wanted: dict[tuple, set[str]] = {}
    for row in db.query(AccessGrant).filter(AccessGrant.permission_key.in_(list(OWN_TO_OTHERS))).all():
        wanted.setdefault((row.group_id, row.user_id, row.workspace_id), set()).add(OWN_TO_OTHERS[row.permission_key])
    for (group_id, user_id, workspace_id), keys in wanted.items():
        for key in sorted(keys):
            if (group_id, user_id, workspace_id, key) in held:
                continue
            db.add(AccessGrant(group_id=group_id, user_id=user_id, workspace_id=workspace_id, permission_key=key))
            created += 1

    # Permissoes reservadas para quem ainda vai se cadastrar
    invite_existing = {
        (row.email, row.workspace_id, row.permission_key)
        for row in db.query(AccessInviteGrant).filter(AccessInviteGrant.permission_key.in_(list(OWN_TO_OTHERS.values()))).all()
    }
    for row in db.query(AccessInviteGrant).filter(AccessInviteGrant.permission_key.in_(list(OWN_TO_OTHERS))).all():
        key = OWN_TO_OTHERS[row.permission_key]
        if (row.email, row.workspace_id, key) not in invite_existing:
            invite_existing.add((row.email, row.workspace_id, key))
            db.add(AccessInviteGrant(email=row.email, workspace_id=row.workspace_id, permission_key=key))
            created += 1

    db.add(AccessMigrationStep(name=OWN_SCOPE_STEP))
    db.commit()
    logger.warning("Permissoes de assinaturas e alertas de outras pessoas: %s linhas criadas", created)
    return created

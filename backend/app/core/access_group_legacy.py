"""Ponte entre as permissões de funcionalidade antigas de um grupo e as novas.

A tela antiga de permissões do grupo (rota PUT /groups/{id}/permissions) e o "reverter" da auditoria falam com as
chaves antigas: ia.gerenciar, ia.usar e analiticos.*. O que vale de verdade agora são as linhas de access_grants, então
estas funções leem e gravam lá, traduzindo: ia.gerenciar vira os cinco itens da IA, e só volta a aparecer quando o grupo
tem os cinco (um grupo com só alguns itens não "gerencia a IA"). A tabela group_permissions deixa de ser escrita."""

from sqlalchemy.orm import Session

from app.core.access_catalog import LEGACY_EXPANSIONS
from app.core.access_catalog import with_implied as catalog_with_implied
from app.core.permission_keys import MANAGED_PERMISSIONS
from app.models.access_grant import AccessGrant

AI_MANAGE_LEGACY = "ia.gerenciar"
AI_MANAGE_ITEMS: tuple[str, ...] = LEGACY_EXPANSIONS[AI_MANAGE_LEGACY]

# As chaves novas que a tela antiga controla; qualquer outra permissão global do grupo não é tocada
CONTROLLED_KEYS: tuple[str, ...] = tuple(key for key in MANAGED_PERMISSIONS if key != AI_MANAGE_LEGACY) + AI_MANAGE_ITEMS


def _controlled_rows(db: Session, group_id: int):
    return db.query(AccessGrant).filter(
        AccessGrant.group_id == group_id,
        AccessGrant.workspace_id.is_(None),
        AccessGrant.permission_key.in_(CONTROLLED_KEYS),
    )


def legacy_keys_of_group(db: Session, group_id: int) -> list[str]:
    """Permissões do grupo no formato antigo, em ordem."""
    held = {row.permission_key for row in _controlled_rows(db, group_id).all()}
    legacy = {key for key in held if key in MANAGED_PERMISSIONS}
    if set(AI_MANAGE_ITEMS) <= held:
        legacy.add(AI_MANAGE_LEGACY)
    return sorted(legacy)


def expand_legacy_keys(legacy_keys: list[str]) -> set[str]:
    """As chaves novas que uma lista no formato antigo vira: ia.gerenciar vira os cinco itens, e o que cada uma exige entra."""
    expanded: set[str] = set()
    for key in legacy_keys:
        expanded.update(LEGACY_EXPANSIONS.get(key, (key,)))
    return set(catalog_with_implied(expanded))


def set_legacy_keys_of_group(db: Session, group_id: int, legacy_keys: list[str]) -> None:
    """Troca só as permissões que a tela antiga controla, gravando-as no modelo novo. Não faz commit."""
    db.flush()  # o que está pendente na sessão precisa existir no banco para o apagar em lote pegar
    _controlled_rows(db, group_id).delete(synchronize_session=False)
    for key in sorted(expand_legacy_keys(legacy_keys)):
        db.add(AccessGrant(group_id=group_id, workspace_id=None, permission_key=key))

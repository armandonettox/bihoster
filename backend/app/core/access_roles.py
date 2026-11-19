"""Ponte entre o papel antigo (Leitor, Editor, Administrador por coleção) e as permissões novas.

As permissões novas (tabela access_grants) são a única fonte da verdade. O papel antigo continua existindo só como
resumo, para o que ainda pergunta "qual o papel desta pessoa na coleção": ele é calculado a partir das permissões.

Para ninguém ganhar acesso por engano, o papel só sobe quando a pessoa tem o conjunto *completo* daquele papel:
uma permissão solta (por exemplo, só "editar a coleção") não faz ninguém virar administrador. Os conjuntos abaixo
ficam fixos aqui, de propósito: se o catálogo ganhar itens novos e os atalhos da tela crescerem, quem já tinha o papel
não é rebaixado em silêncio.

Esta ponte também serve à matriz antiga da janela "Editar coleção", que dá um papel a um grupo numa coleção: ela agora
grava as permissões do atalho correspondente (ver `set_group_role`)."""

from sqlalchemy.orm import Session

from app.core.access_catalog import COLLECTION_VIEW, PRESETS, with_implied
from app.models.access_grant import AccessGrant
from app.models.user import UserRole

# O que o papel Editor sempre pôde fazer
EDITOR_CORE: frozenset[str] = frozenset(
    {
        "relatorio.publicar",
        "relatorio.editar",
        "relatorio.reordenar",
        "relatorio.miniatura",
        "relatorio.excluir",
        "powerbi.atualizar",
        "assinatura.criar",
        "assinatura.editar",
        "assinatura.excluir",
        "assinatura.executar",
        "alerta.criar",
        "alerta.editar",
        "alerta.excluir",
    }
)

# O que o papel Administrador da coleção tem a mais que o Editor
ADMIN_CORE: frozenset[str] = frozenset(
    {
        "colecao.editar",
        "colecao.excluir",
        "colecao.auditoria",
        "assinatura.qualquer-dominio",
    }
)

# Atalho da tela que equivale a cada papel antigo
ROLE_PRESET: dict[UserRole, str] = {
    UserRole.viewer: "leitor",
    UserRole.editor: "editor",
    UserRole.admin: "administrador",
}


def role_from_keys(keys: set[str] | frozenset[str] | list[str] | tuple[str, ...] | None) -> UserRole | None:
    """Papel de quem tem estas permissões numa coleção. Sem "ver a coleção" não há papel (a pessoa não enxerga a coleção)."""
    granted = set(keys or ())
    if COLLECTION_VIEW not in granted:
        return None
    if EDITOR_CORE <= granted and ADMIN_CORE <= granted:
        return UserRole.admin
    if EDITOR_CORE <= granted:
        return UserRole.editor
    return UserRole.viewer


def keys_of_role(role: UserRole) -> list[str]:
    """As permissões que um papel antigo vira (as do atalho da tela, já com o que elas exigem)."""
    return with_implied(PRESETS[ROLE_PRESET[role]])


def group_workspace_keys(db: Session, group_id: int, workspace_id: int) -> set[str]:
    rows = (
        db.query(AccessGrant.permission_key)
        .filter(AccessGrant.group_id == group_id, AccessGrant.workspace_id == workspace_id)
        .all()
    )
    return {row.permission_key for row in rows}


def get_group_role(db: Session, group_id: int, workspace_id: int) -> UserRole | None:
    """Papel de um grupo numa coleção; None quando o grupo não tem nenhuma permissão nela."""
    keys = group_workspace_keys(db, group_id, workspace_id)
    if not keys:
        return None
    return role_from_keys(with_implied(keys))


def group_roles_in_workspace(db: Session, workspace_id: int) -> dict[int, UserRole]:
    """Papel de cada grupo que tem alguma permissão na coleção, numa consulta só."""
    rows = (
        db.query(AccessGrant.group_id, AccessGrant.permission_key)
        .filter(AccessGrant.workspace_id == workspace_id, AccessGrant.group_id.isnot(None))
        .all()
    )
    keys_by_group: dict[int, set[str]] = {}
    for group_id, key in rows:
        keys_by_group.setdefault(group_id, set()).add(key)
    return {group_id: role_from_keys(with_implied(keys)) or UserRole.viewer for group_id, keys in keys_by_group.items()}


def remove_group_role(db: Session, group_id: int, workspace_id: int) -> None:
    """Tira todas as permissões do grupo nesta coleção. Não faz commit."""
    db.flush()  # o que ainda está pendente na sessão precisa existir no banco para o apagar em lote pegar
    db.query(AccessGrant).filter(AccessGrant.group_id == group_id, AccessGrant.workspace_id == workspace_id).delete(
        synchronize_session=False
    )


def set_group_role(db: Session, group_id: int, workspace_id: int, role: UserRole) -> None:
    """Dá ao grupo as permissões do atalho do papel, no lugar do que ele tinha nesta coleção. Não faz commit."""
    remove_group_role(db, group_id, workspace_id)
    for key in keys_of_role(role):
        db.add(AccessGrant(group_id=group_id, workspace_id=workspace_id, permission_key=key))


def give_user_role(db: Session, user_id: int, workspace_id: int, role: UserRole) -> None:
    """Dá direto a uma pessoa as permissões do atalho do papel numa coleção, sem tirar o que ela já tinha. Não faz commit."""
    existing = {
        row.permission_key
        for row in db.query(AccessGrant.permission_key).filter(
            AccessGrant.user_id == user_id, AccessGrant.workspace_id == workspace_id
        )
    }
    for key in keys_of_role(role):
        if key not in existing:
            db.add(AccessGrant(user_id=user_id, workspace_id=workspace_id, permission_key=key))

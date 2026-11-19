"""Atalhos de teste para montar acesso pelo modelo novo de permissoes (PUT /access/groups/{id}).

As rotas antigas (matriz de acesso por colecao e permissoes de grupo no formato antigo) foram removidas; os testes que
precisam de "um grupo com papel Editor numa colecao" ou "um grupo que gerencia a IA" usam estas funcoes. Cada uma le o
que o grupo ja tem e troca so a parte que mexe, como as rotas antigas faziam."""

from app.core.access_catalog import with_implied
from app.core.access_group_legacy import CONTROLLED_KEYS, expand_legacy_keys
from app.core.access_roles import keys_of_role, role_from_keys
from app.models.user import UserRole


def _blocos(client, headers, group_id: int) -> dict[int | None, list[str]]:
    resposta = client.get(f"/access/groups/{group_id}", headers=headers)
    assert resposta.status_code == 200, resposta.text
    return {b["workspace_id"]: list(b["permissions"]) for b in resposta.json()["blocks"]}


def _gravar(client, headers, group_id: int, por_escopo: dict[int | None, list[str]]):
    blocos = [{"workspace_id": ws, "permissions": chaves} for ws, chaves in por_escopo.items() if chaves]
    return client.put(f"/access/groups/{group_id}", json={"blocks": blocos}, headers=headers)


def grupo_padrao_id(client, headers) -> int:
    """O grupo "Todos os usuarios", que toda colecao nova enxerga."""
    return next(g["id"] for g in client.get("/groups/", headers=headers).json() if g["is_default"])


def dar_papel(client, headers, workspace_id: int, group_id: int, papel: str):
    """Da ao grupo as permissoes do atalho do papel (viewer, editor, admin) numa colecao, no lugar do que ele tinha ali."""
    por_escopo = _blocos(client, headers, group_id)
    por_escopo[workspace_id] = keys_of_role(UserRole(papel))
    resposta = _gravar(client, headers, group_id, por_escopo)
    assert resposta.status_code == 200, resposta.text
    return resposta


def tirar_acesso(client, headers, workspace_id: int, group_id: int):
    """Tira do grupo todas as permissoes numa colecao."""
    por_escopo = _blocos(client, headers, group_id)
    por_escopo.pop(workspace_id, None)
    resposta = _gravar(client, headers, group_id, por_escopo)
    assert resposta.status_code == 200, resposta.text
    return resposta


def papel_do_grupo(client, headers, workspace_id: int, group_id: int) -> str | None:
    """O papel que as permissoes do grupo numa colecao resumem (viewer, editor, admin), ou None se nao tem nenhuma."""
    chaves = _blocos(client, headers, group_id).get(workspace_id)
    if not chaves:
        return None
    papel = role_from_keys(with_implied(chaves))
    return papel.value if papel else None


def papeis_na_colecao(client, headers, workspace_id: int) -> dict[int, str | None]:
    """O papel de cada grupo numa colecao (None = sem acesso), como a matriz antiga mostrava."""
    grupos = client.get("/groups/", headers=headers).json()
    return {g["id"]: papel_do_grupo(client, headers, workspace_id, g["id"]) for g in grupos if not g["is_admin_group"]}


def dar_permissoes_do_grupo(client, headers, group_id: int, chaves_antigas: list[str]):
    """Troca so as permissoes globais que a tela antiga controlava (ia.gerenciar, ia.usar, analiticos.*), no formato
    antigo: ia.gerenciar vira os cinco itens da IA. As outras permissoes do grupo ficam como estavam."""
    por_escopo = _blocos(client, headers, group_id)
    restantes = [k for k in por_escopo.get(None, []) if k not in CONTROLLED_KEYS]
    por_escopo[None] = sorted(set(restantes) | expand_legacy_keys(chaves_antigas))
    return _gravar(client, headers, group_id, por_escopo)


def registro_antigo_de_permissoes(client, db_session, admin_headers, group_id: int, group_name: str, before: list[str], after: list[str]) -> int:
    """Cria na auditoria um registro de troca de permissoes de grupo no formato antigo (o que a rota antiga gravava) e
    devolve o id. Nenhuma tela gera mais esse registro, mas instalacoes que ja o tem continuam podendo reverte-lo."""
    from app.core.audit import log_action
    from app.models.audit_log import AuditLog

    quem = client.get("/auth/me", headers=admin_headers).json()["id"]
    log_action(
        db_session,
        action="set_group_permissions",
        entity="group",
        user_id=quem,
        entity_id=group_id,
        details=", ".join(after) or "nenhuma",
        change={"kind": "group_permissions", "group_id": group_id, "group_name": group_name, "before": before, "after": after},
    )
    return db_session.query(AuditLog).filter(AuditLog.action == "set_group_permissions").order_by(AuditLog.id.desc()).first().id

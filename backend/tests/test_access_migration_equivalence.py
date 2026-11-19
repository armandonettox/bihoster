"""A copia unica dos papeis e permissoes antigos para as permissoes novas nao pode mudar o acesso de ninguem.

Para cada cenario aleatorio (com semente fixa, para ser repetivel) monta o estado ANTIGO (papel de cada grupo em cada
colecao, permissoes de IA e de analiticos por grupo, quem esta em quais grupos), roda a migracao e confere, pessoa por
pessoa e colecao por colecao, que o acesso de agora e o mesmo de antes. Dados de producao nunca entram aqui."""

import random

import pytest

from app.core.access_migration import migrate_legacy_access
from app.core.ai_access import ai_permissions
from app.core.analytics_access import analytics_permissions
from app.core.permission_keys import ANALYTICS_PERMISSIONS, with_implied
from app.core.workspace_deps import (
    ROLE_ORDER,
    add_user_to_admin_group,
    get_effective_role,
    get_effective_roles_map,
    get_or_create_default_group,
    is_platform_admin,
)
from app.models.group_permission import GroupPermission
from app.models.user import UserRole
from app.models.workspace import Group, GroupMember, GroupWorkspaceAccess

CHAVES_ANTIGAS = ["ia.gerenciar", "ia.usar", "analiticos.ver", "analiticos.criar", "analiticos.editar", "analiticos.excluir"]


def _papel_antigo(db, user_id, workspace_id):
    """O papel como o modelo antigo calculava: o maior entre os grupos da pessoa nesta colecao."""
    papeis = [
        papel
        for (papel,) in db.query(GroupWorkspaceAccess.role)
        .join(GroupMember, GroupMember.group_id == GroupWorkspaceAccess.group_id)
        .filter(GroupWorkspaceAccess.workspace_id == workspace_id, GroupMember.user_id == user_id)
        .all()
    ]
    return max(papeis, key=lambda p: ROLE_ORDER[p]) if papeis else None


def _chaves_antigas_da_pessoa(db, user_id):
    linhas = (
        db.query(GroupPermission.permission_key)
        .join(GroupMember, GroupMember.group_id == GroupPermission.group_id)
        .filter(GroupMember.user_id == user_id)
        .all()
    )
    return {chave for (chave,) in linhas}


def _montar_cenario_antigo(db, make_user, make_workspace, semente: int):
    sorteio = random.Random(semente)
    pessoas = [make_user(f"pessoa{semente}-{i}@teste.com") for i in range(6)]
    colecoes = [make_workspace(f"Colecao {semente}-{i}", slug=f"c{semente}-{i}") for i in range(4)]
    padrao = get_or_create_default_group(db)
    grupos = [padrao]
    for i in range(sorteio.randint(2, 4)):
        grupo = Group(name=f"Grupo {semente}-{i}")
        db.add(grupo)
        db.commit()
        grupos.append(grupo)

    for pessoa in pessoas:
        for grupo in grupos:
            ja_esta = db.query(GroupMember).filter_by(group_id=grupo.id, user_id=pessoa.id).first()
            # Todo mundo esta no grupo padrao; nos outros, por sorteio
            if not ja_esta and sorteio.random() < 0.5:
                db.add(GroupMember(group_id=grupo.id, user_id=pessoa.id))
    db.commit()

    for grupo in grupos:
        for colecao in colecoes:
            papel = sorteio.choice([None, None, UserRole.viewer, UserRole.editor, UserRole.admin])
            if papel is not None:
                db.add(GroupWorkspaceAccess(group_id=grupo.id, workspace_id=colecao.id, role=papel))
        for chave in CHAVES_ANTIGAS:
            if sorteio.random() < 0.3:
                db.add(GroupPermission(group_id=grupo.id, permission_key=chave))
    db.commit()

    # Um administrador da plataforma em alguns cenarios
    if semente % 3 == 0:
        add_user_to_admin_group(db, pessoas[0].id)
    return pessoas, colecoes


@pytest.mark.parametrize("semente", range(40))
def test_migracao_nao_muda_o_acesso_de_ninguem(db_session, make_user, make_workspace, semente):
    pessoas, colecoes = _montar_cenario_antigo(db_session, make_user, make_workspace, semente)
    # O que o modelo antigo dizia, lido ANTES de migrar
    antes = {
        (p.id, c.id): _papel_antigo(db_session, p.id, c.id)
        for p in pessoas
        for c in colecoes
    }
    chaves_antes = {p.id: _chaves_antigas_da_pessoa(db_session, p.id) for p in pessoas}

    migrate_legacy_access(db_session)

    for pessoa in pessoas:
        if is_platform_admin(db_session, pessoa.id):
            # Administrador da plataforma continua com tudo, em qualquer colecao
            assert all(get_effective_role(db_session, pessoa.id, c.id) == UserRole.admin for c in colecoes)
            continue

        mapa = get_effective_roles_map(db_session, pessoa.id)
        for colecao in colecoes:
            esperado = antes[(pessoa.id, colecao.id)]
            assert get_effective_role(db_session, pessoa.id, colecao.id) == esperado, (semente, pessoa.email, colecao.name)
            assert mapa.get(colecao.id) == esperado, (semente, pessoa.email, colecao.name)

        antigas = chaves_antes[pessoa.id]
        novas = ai_permissions(db_session, pessoa.id)
        assert ("ia.gerenciar" in novas) == ("ia.gerenciar" in antigas), (semente, pessoa.email)
        assert ("ia.usar" in novas) == ("ia.usar" in antigas), (semente, pessoa.email)
        # Analiticos: criar, editar e excluir sempre implicaram ver
        esperadas = set(with_implied({k for k in antigas if k in ANALYTICS_PERMISSIONS}))
        assert analytics_permissions(db_session, pessoa.id) == esperadas, (semente, pessoa.email)


def test_migracao_roda_uma_vez_e_nao_devolve_o_que_foi_tirado_depois(db_session, make_user, make_workspace):
    pessoas, colecoes = _montar_cenario_antigo(db_session, make_user, make_workspace, 7)
    migrate_legacy_access(db_session)

    # Depois da copia, o administrador tira tudo na tela nova; reiniciar o servidor nao pode devolver
    from app.models.access_grant import AccessGrant

    db_session.query(AccessGrant).delete()
    db_session.commit()
    assert migrate_legacy_access(db_session) == 0

    for pessoa in pessoas:
        if not is_platform_admin(db_session, pessoa.id):
            assert all(get_effective_role(db_session, pessoa.id, c.id) is None for c in colecoes)

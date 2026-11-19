"""Permissoes unificadas, parte 1 da troca da regra: o papel antigo agora e calculado a partir das permissoes novas,
a matriz antiga da janela "Editar colecao" grava permissoes, e as dependencias por item do catalogo."""

import pytest
from fastapi import HTTPException

from app.core.access_catalog import PRESETS, WORKSPACE_KEYS, with_implied
from app.core.access_deps import require_global_permission, require_workspace_permission
from app.core.access_roles import (
    ADMIN_CORE,
    EDITOR_CORE,
    get_group_role,
    group_roles_in_workspace,
    keys_of_role,
    remove_group_role,
    role_from_keys,
    set_group_role,
)
from app.core.workspace_deps import (
    add_user_to_admin_group,
    ensure_default_group_access,
    get_effective_role,
    get_effective_roles_map,
    get_or_create_default_group,
)
from app.models.access_grant import AccessGrant
from app.models.user import UserRole
from app.models.workspace import Group, GroupMember
from tests.access_helpers import dar_papel, papeis_na_colecao, tirar_acesso

PASSWORD = "SenhaForte123"


def _grupo(db, nome="Grupo", membros=()):
    group = Group(name=nome)
    db.add(group)
    db.commit()
    for user in membros:
        db.add(GroupMember(group_id=group.id, user_id=user.id))
    db.commit()
    return group


def _dar_a_pessoa(db, user, workspace_id, keys):
    for key in with_implied(keys):
        db.add(AccessGrant(user_id=user.id, workspace_id=workspace_id, permission_key=key))
    db.commit()


class TestPapelDerivadoDasPermissoes:
    def test_sem_ver_a_colecao_nao_ha_papel(self):
        assert role_from_keys(set()) is None
        assert role_from_keys(None) is None
        assert role_from_keys({"relatorio.publicar"}) is None

    def test_so_ver_e_leitor(self):
        assert role_from_keys({"colecao.ver"}) == UserRole.viewer

    def test_o_conjunto_completo_de_cada_papel(self):
        assert role_from_keys({"colecao.ver", *EDITOR_CORE}) == UserRole.editor
        assert role_from_keys({"colecao.ver", *EDITOR_CORE, *ADMIN_CORE}) == UserRole.admin

    def test_permissao_solta_nunca_sobe_o_papel(self):
        # Só editar a coleção não faz ninguém administrador; um pedaço do editor não faz editor
        assert role_from_keys({"colecao.ver", "colecao.editar"}) == UserRole.viewer
        assert role_from_keys({"colecao.ver", *EDITOR_CORE, "colecao.editar"}) == UserRole.editor
        parcial = set(EDITOR_CORE) - {"alerta.excluir"}
        assert role_from_keys({"colecao.ver", *parcial}) == UserRole.viewer

    @pytest.mark.parametrize("role", [UserRole.viewer, UserRole.editor, UserRole.admin])
    def test_ida_e_volta_com_os_atalhos_da_tela(self, role):
        assert role_from_keys(keys_of_role(role)) == role

    def test_os_conjuntos_fixos_cabem_nos_atalhos_do_catalogo(self):
        # Se alguém mexer no catálogo e tirar um item destes dos atalhos, o papel antigo deixaria de bater
        assert EDITOR_CORE <= set(PRESETS["editor"])
        assert EDITOR_CORE | ADMIN_CORE <= set(PRESETS["administrador"])
        assert not ADMIN_CORE & set(PRESETS["editor"])

    def test_catalogo_que_cresce_nao_rebaixa_quem_ja_era_administrador(self):
        so_o_antigo = {"colecao.ver", *EDITOR_CORE, *ADMIN_CORE}
        assert so_o_antigo < set(WORKSPACE_KEYS)  # o catálogo tem mais itens que o conjunto fixo
        assert role_from_keys(so_o_antigo) == UserRole.admin


class TestPapelEfetivoVemDasPermissoes:
    def test_grupo_com_permissoes_na_colecao(self, db_session, make_user, make_workspace):
        user, ws = make_user("a@teste.com"), make_workspace("Vendas")
        grupo = _grupo(db_session, membros=[user])
        set_group_role(db_session, grupo.id, ws.id, UserRole.editor)
        db_session.commit()

        assert get_effective_role(db_session, user.id, ws.id) == UserRole.editor
        assert get_effective_roles_map(db_session, user.id) == {ws.id: UserRole.editor}

    def test_permissao_dada_direto_a_pessoa_tambem_conta(self, db_session, make_user, make_workspace):
        user, ws = make_user("b@teste.com"), make_workspace("Vendas")
        _dar_a_pessoa(db_session, user, ws.id, ["relatorio.excluir"])

        # Sem o pacote completo do editor, ela só vê a coleção (e faz o que a permissão dela permite)
        assert get_effective_role(db_session, user.id, ws.id) == UserRole.viewer

    def test_grupo_e_pessoa_somam(self, db_session, make_user, make_workspace):
        user, ws = make_user("c@teste.com"), make_workspace("Vendas")
        grupo = _grupo(db_session, membros=[user])
        set_group_role(db_session, grupo.id, ws.id, UserRole.viewer)
        _dar_a_pessoa(db_session, user, ws.id, EDITOR_CORE)
        db_session.commit()

        assert get_effective_role(db_session, user.id, ws.id) == UserRole.editor

    def test_dois_grupos_prevalece_o_maior(self, db_session, make_user, make_workspace):
        user, ws = make_user("d@teste.com"), make_workspace("Vendas")
        leitor = _grupo(db_session, "Leitor", [user])
        editor = _grupo(db_session, "Editor", [user])
        set_group_role(db_session, leitor.id, ws.id, UserRole.viewer)
        set_group_role(db_session, editor.id, ws.id, UserRole.editor)
        db_session.commit()

        assert get_effective_role(db_session, user.id, ws.id) == UserRole.editor

    def test_so_a_colecao_certa(self, db_session, make_user, make_workspace):
        user, a, b = make_user("e@teste.com"), make_workspace("A"), make_workspace("B")
        grupo = _grupo(db_session, membros=[user])
        set_group_role(db_session, grupo.id, a.id, UserRole.admin)
        db_session.commit()

        assert get_effective_role(db_session, user.id, a.id) == UserRole.admin
        assert get_effective_role(db_session, user.id, b.id) is None
        assert set(get_effective_roles_map(db_session, user.id)) == {a.id}

    def test_administrador_da_plataforma_e_admin_em_tudo(self, db_session, make_user, make_workspace):
        admin, ws = make_user("adm@teste.com"), make_workspace("RH")
        add_user_to_admin_group(db_session, admin.id)

        assert get_effective_role(db_session, admin.id, ws.id) == UserRole.admin
        assert get_effective_roles_map(db_session, admin.id) == {ws.id: UserRole.admin}


class TestPonteDoPapelAntigo:
    def test_dar_um_papel_troca_o_que_o_grupo_tinha(self, db_session, make_workspace):
        ws = make_workspace("Vendas")
        grupo = _grupo(db_session)
        set_group_role(db_session, grupo.id, ws.id, UserRole.admin)
        set_group_role(db_session, grupo.id, ws.id, UserRole.viewer)
        db_session.commit()

        assert get_group_role(db_session, grupo.id, ws.id) == UserRole.viewer
        linhas = db_session.query(AccessGrant).filter_by(group_id=grupo.id, workspace_id=ws.id).all()
        assert [r.permission_key for r in linhas] == ["colecao.ver"]

    def test_tirar_o_papel_apaga_so_aquela_colecao(self, db_session, make_workspace):
        a, b = make_workspace("A"), make_workspace("B")
        grupo = _grupo(db_session)
        set_group_role(db_session, grupo.id, a.id, UserRole.editor)
        set_group_role(db_session, grupo.id, b.id, UserRole.editor)
        remove_group_role(db_session, grupo.id, a.id)
        db_session.commit()

        assert get_group_role(db_session, grupo.id, a.id) is None
        assert get_group_role(db_session, grupo.id, b.id) == UserRole.editor

    def test_grupo_com_permissao_solta_aparece_como_leitor_e_nao_some(self, db_session, make_workspace):
        ws = make_workspace("Vendas")
        grupo = _grupo(db_session)
        db_session.add(AccessGrant(group_id=grupo.id, workspace_id=ws.id, permission_key="relatorio.excluir"))
        db_session.commit()

        assert group_roles_in_workspace(db_session, ws.id) == {grupo.id: UserRole.viewer}

    def test_grupo_padrao_ganha_leitura_na_colecao_nova_e_nao_perde_o_que_ja_tinha(self, db_session, make_workspace):
        novo, antigo = make_workspace("Novo"), make_workspace("Antigo")
        padrao = get_or_create_default_group(db_session)
        set_group_role(db_session, padrao.id, antigo.id, UserRole.editor)
        db_session.commit()

        ensure_default_group_access(db_session, novo.id, UserRole.viewer)
        ensure_default_group_access(db_session, antigo.id, UserRole.viewer)

        assert get_group_role(db_session, padrao.id, novo.id) == UserRole.viewer
        assert get_group_role(db_session, padrao.id, antigo.id) == UserRole.editor


class TestAcessoPelaApi:
    def _entrar(self, client, email):
        client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
        token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    def test_papel_dado_ao_grupo_vale_para_quem_esta_nele(self, client, db_session):
        admin = self._entrar(client, "admin@example.com")
        pessoa = self._entrar(client, "pessoa@example.com")
        ws = client.post("/workspaces/", json={"name": "Vendas"}, headers=admin).json()["id"]
        grupo = client.post("/groups/", json={"name": "Time"}, headers=admin).json()["id"]
        assert client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=admin).status_code == 201

        dar_papel(client, admin, ws, grupo, "editor")

        minhas = {w["id"]: w["role"] for w in client.get("/workspaces/", headers=pessoa).json()}
        assert minhas[ws] == "editor"
        assert papeis_na_colecao(client, admin, ws)[grupo] == "editor"

        tirar_acesso(client, admin, ws, grupo)
        assert papeis_na_colecao(client, admin, ws)[grupo] is None
        # Sem o grupo Time, sobra a leitura que todo mundo tem pelo grupo padrão
        minhas = {w["id"]: w["role"] for w in client.get("/workspaces/", headers=pessoa).json()}
        assert minhas[ws] == "viewer"

    def test_colecao_nova_da_leitura_a_todos(self, client):
        admin = self._entrar(client, "admin@example.com")
        pessoa = self._entrar(client, "pessoa@example.com")
        ws = client.post("/workspaces/", json={"name": "Aberta"}, headers=admin).json()["id"]

        minhas = {w["id"]: w["role"] for w in client.get("/workspaces/", headers=pessoa).json()}
        assert minhas[ws] == "viewer"

    def test_colecao_criada_sem_visibilidade_geral_so_aparece_para_quem_tem_acesso(self, client):
        admin = self._entrar(client, "admin@example.com")
        pessoa = self._entrar(client, "pessoa@example.com")

        privada = client.post("/workspaces/", json={"name": "Privada", "everyone_can_view": False}, headers=admin).json()["id"]
        aberta = client.post("/workspaces/", json={"name": "Aberta"}, headers=admin).json()["id"]

        minhas = {w["id"] for w in client.get("/workspaces/", headers=pessoa).json()}
        assert aberta in minhas and privada not in minhas
        # O administrador da plataforma continua vendo as duas
        todas = {w["id"] for w in client.get("/workspaces/", headers=admin).json()}
        assert {privada, aberta} <= todas

    def test_o_que_o_admin_da_na_tela_nova_vale_na_regra(self, client):
        admin = self._entrar(client, "admin@example.com")
        pessoa = self._entrar(client, "pessoa@example.com")
        ws = client.post("/workspaces/", json={"name": "Vendas"}, headers=admin).json()["id"]
        pessoa_id = next(u["id"] for u in client.get("/users/", headers=admin).json() if u["email"] == "pessoa@example.com")

        client.put(
            f"/access/users/{pessoa_id}",
            json={"blocks": [{"workspace_id": ws, "permissions": sorted(EDITOR_CORE)}]},
            headers=admin,
        )

        minhas = {w["id"]: w["role"] for w in client.get("/workspaces/", headers=pessoa).json()}
        assert minhas[ws] == "editor"


class TestDependenciasPorItem:
    def test_nome_errado_ou_escopo_errado_quebra_na_declaracao(self):
        with pytest.raises(ValueError):
            require_workspace_permission("relatorio.nao-existe")
        with pytest.raises(ValueError):
            require_workspace_permission("ia.usar")
        with pytest.raises(ValueError):
            require_global_permission("relatorio.publicar")

    def test_permissao_de_colecao(self, db_session, make_user, make_workspace):
        com, sem, admin = make_user("com@teste.com"), make_user("sem@teste.com"), make_user("adm@teste.com")
        ws, outra = make_workspace("Vendas"), make_workspace("Outra")
        add_user_to_admin_group(db_session, admin.id)
        _dar_a_pessoa(db_session, com, ws.id, ["relatorio.publicar"])
        verifica = require_workspace_permission("relatorio.publicar")

        assert verifica(workspace_id=ws.id, db=db_session, current_user=com) is com
        assert verifica(workspace_id=outra.id, db=db_session, current_user=admin) is admin
        for user, colecao in ((sem, ws.id), (com, outra.id)):
            with pytest.raises(HTTPException) as erro:
                verifica(workspace_id=colecao, db=db_session, current_user=user)
            assert erro.value.status_code == 403

    def test_permissao_global_e_da_pessoa_ou_do_grupo(self, db_session, make_user):
        pessoa, por_grupo, sem = make_user("p@teste.com"), make_user("g@teste.com"), make_user("s@teste.com")
        db_session.add(AccessGrant(user_id=pessoa.id, permission_key="membros.adicionar"))
        grupo = _grupo(db_session, membros=[por_grupo])
        db_session.add(AccessGrant(group_id=grupo.id, permission_key="membros.adicionar"))
        db_session.commit()
        verifica = require_global_permission("membros.adicionar")

        assert verifica(db=db_session, current_user=pessoa) is pessoa
        assert verifica(db=db_session, current_user=por_grupo) is por_grupo
        with pytest.raises(HTTPException) as erro:
            verifica(db=db_session, current_user=sem)
        assert erro.value.status_code == 403

    def test_ver_membros_nao_da_adicionar_membros(self, db_session, make_user):
        # Ter "ver membros" não dá "adicionar membros"
        pessoa = make_user("v@teste.com")
        db_session.add(AccessGrant(user_id=pessoa.id, permission_key="membros.ver"))
        db_session.commit()

        with pytest.raises(HTTPException):
            require_global_permission("membros.adicionar")(db=db_session, current_user=pessoa)

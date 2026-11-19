"""Permissoes unificadas, parte 4 da troca da regra: a IA passa a ser cobrada item por item (chaves, modelos, bloqueios,
registro, consumo e usar o chat), lendo as permissões novas. A rota antiga de permissões do grupo grava no modelo novo.

Mesma prova das partes anteriores: quem tem só um item faz aquilo e mais nada. Corpo vazio de propósito: sem permissão a
rota responde 403 antes de olhar o corpo."""

import pytest

from app.core.access_catalog import CATALOG
from app.core.access_group_legacy import legacy_keys_of_group, set_legacy_keys_of_group
from app.core.ai_access import AI_ITEM_KEYS, AI_MANAGE_ITEMS
from app.models.access_grant import AccessGrant
from app.models.workspace import Group, GroupMember
from tests.access_helpers import dar_permissoes_do_grupo

PASSWORD = "SenhaForte123"

# (método, caminho, item exigido)
ROTAS = [
    ("get", "/settings/ai/", "ia.chaves"),
    ("put", "/settings/ai/nao-existe", "ia.chaves"),
    ("post", "/settings/ai/nao-existe/test", "ia.chaves"),
    ("get", "/settings/ai/nao-existe/models", "ia.modelos"),
    ("get", "/ai/options/", "ia.modelos"),
    ("put", "/ai/options/", "ia.modelos"),
    ("get", "/ai/reports/review", "ia.bloqueios"),
    ("get", "/ai/reports/1/schema", "ia.bloqueios"),
    ("get", "/ai/reports/1/settings", "ia.bloqueios"),
    ("put", "/ai/reports/1/settings", "ia.bloqueios"),
    ("post", "/ai/reports/1/review", "ia.bloqueios"),
    ("get", "/ai/reports/1/check", "ia.bloqueios"),
    ("get", "/ai/log/", "ia.registro"),
    ("get", "/ai/usage/", "ia.consumo"),
    ("post", "/ai/chat", "ia.usar"),
    ("post", "/ai/reports/1/page-image", "ia.usar"),
    ("get", "/ai/conversations/", "ia.usar"),
    ("get", "/ai/conversations/1", "ia.usar"),
]
CHAVES = sorted({chave for _, _, chave in ROTAS})


def _entrar(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def cenario(client):
    admin = _entrar(client, "admin@example.com")
    pessoa = _entrar(client, "pessoa@example.com")
    pessoa_id = next(u["id"] for u in client.get("/users/", headers=admin).json() if u["email"] == "pessoa@example.com")
    return {"admin": admin, "pessoa": pessoa, "pessoa_id": pessoa_id}


def _dar(client, c, chaves):
    resp = client.put(
        f"/access/users/{c['pessoa_id']}",
        json={"blocks": [{"workspace_id": None, "permissions": chaves}]},
        headers=c["admin"],
    )
    assert resp.status_code == 200, resp.text


def _chamar(client, c, metodo, caminho, quem="pessoa"):
    return client.request(metodo.upper(), caminho, json={}, headers=c[quem])


class TestSemPermissao:
    @pytest.mark.parametrize("metodo,caminho,chave", ROTAS)
    def test_quem_nao_tem_nenhum_item_de_ia_recebe_403(self, client, cenario, metodo, caminho, chave):
        assert _chamar(client, cenario, metodo, caminho).status_code == 403

    @pytest.mark.parametrize("metodo,caminho,chave", ROTAS)
    def test_administrador_da_plataforma_passa_em_todas(self, client, cenario, metodo, caminho, chave):
        assert _chamar(client, cenario, metodo, caminho, quem="admin").status_code != 403


class TestCadaItemFazSoOQueDiz:
    @pytest.mark.parametrize("chave", CHAVES)
    def test_um_item_libera_so_as_rotas_dele(self, client, cenario, chave):
        _dar(client, cenario, [chave])

        for metodo, caminho, exigida in ROTAS:
            status = _chamar(client, cenario, metodo, caminho).status_code
            if exigida == chave:
                assert status != 403, (metodo, caminho)
            else:
                assert status == 403, (metodo, caminho, chave)

    def test_gerenciar_a_ia_com_os_cinco_itens_nao_da_usar_o_chat(self, client, cenario):
        _dar(client, cenario, list(AI_MANAGE_ITEMS))
        assert _chamar(client, cenario, "post", "/ai/chat").status_code == 403
        assert _chamar(client, cenario, "get", "/ai/log/").status_code != 403

    def test_a_permissao_dada_a_um_grupo_vale_para_quem_esta_nele(self, client, cenario):
        grupo = client.post("/groups/", json={"name": "Dados"}, headers=cenario["admin"]).json()["id"]
        client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=cenario["admin"])
        client.put(
            f"/access/groups/{grupo}",
            json={"blocks": [{"workspace_id": None, "permissions": ["ia.registro"]}]},
            headers=cenario["admin"],
        )

        assert _chamar(client, cenario, "get", "/ai/log/").status_code != 403
        assert _chamar(client, cenario, "get", "/ai/usage/").status_code == 403


class TestResumoDaTela:
    def _acesso(self, client, c):
        resp = client.get("/ai/access", headers=c["pessoa"])
        assert resp.status_code == 200
        return resp.json()

    def test_sem_nada(self, client, cenario):
        assert self._acesso(client, cenario) == {"can_manage": False, "can_use": False, "permissions": []}

    def test_so_usar(self, client, cenario):
        _dar(client, cenario, ["ia.usar"])
        assert self._acesso(client, cenario) == {"can_manage": False, "can_use": True, "permissions": ["ia.usar"]}

    def test_qualquer_item_de_gerencia_mostra_a_area_de_configuracao(self, client, cenario):
        _dar(client, cenario, ["ia.consumo"])
        acesso = self._acesso(client, cenario)
        assert acesso["can_manage"] is True and acesso["can_use"] is False
        assert acesso["permissions"] == ["ia.consumo"]

    def test_o_administrador_tem_tudo(self, client, cenario):
        acesso = client.get("/ai/access", headers=cenario["admin"]).json()
        assert acesso["can_manage"] and acesso["can_use"]
        assert acesso["permissions"] == list(AI_ITEM_KEYS)


class TestPermissoesAntigasDeGrupoPelaPonte:
    """O formato antigo (ia.gerenciar, ia.usar, analiticos.*) so existe agora na ponte core/access_group_legacy.py, que
    traduz de e para as permissoes novas (usada pelo reverter de registros antigos da auditoria e por estes testes)."""

    def _grupo(self, client, c):
        return client.post("/groups/", json={"name": "Dados"}, headers=c["admin"]).json()["id"]

    def test_gerenciar_a_ia_antigo_liga_os_cinco_itens_no_modelo_novo(self, client, cenario, db_session):
        grupo = self._grupo(client, cenario)
        resp = dar_permissoes_do_grupo(client, cenario["admin"], grupo, ["ia.gerenciar"])
        assert resp.status_code == 200

        linhas = db_session.query(AccessGrant).filter_by(group_id=grupo).all()
        assert sorted(r.permission_key for r in linhas) == sorted(AI_MANAGE_ITEMS)
        assert all(r.workspace_id is None for r in linhas)
        assert legacy_keys_of_group(db_session, grupo) == ["ia.gerenciar"]

    def test_e_vale_na_regra_para_quem_esta_no_grupo(self, client, cenario):
        grupo = self._grupo(client, cenario)
        client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=cenario["admin"])
        dar_permissoes_do_grupo(client, cenario["admin"], grupo, ["ia.gerenciar", "ia.usar"])

        assert _chamar(client, cenario, "get", "/ai/log/").status_code != 403
        assert _chamar(client, cenario, "post", "/ai/chat").status_code != 403

    def test_grupo_com_so_alguns_itens_nao_aparece_como_gerenciar_a_ia(self, client, cenario, db_session):
        grupo = self._grupo(client, cenario)
        client.put(
            f"/access/groups/{grupo}",
            json={"blocks": [{"workspace_id": None, "permissions": ["ia.chaves", "ia.modelos", "ia.usar"]}]},
            headers=cenario["admin"],
        )
        assert legacy_keys_of_group(db_session, grupo) == ["ia.usar"]

    def test_troca_so_as_chaves_da_tela_antiga_e_nao_toca_nas_outras(self, client, cenario, db_session):
        grupo = self._grupo(client, cenario)
        client.put(
            f"/access/groups/{grupo}",
            json={"blocks": [{"workspace_id": None, "permissions": ["membros.ver", "ia.usar"]}]},
            headers=cenario["admin"],
        )

        dar_permissoes_do_grupo(client, cenario["admin"], grupo, ["analiticos.criar"])

        chaves = sorted(r.permission_key for r in db_session.query(AccessGrant).filter_by(group_id=grupo))
        # ia.usar saiu (a lista antiga mandou so analiticos), membros.ver ficou, e criar exige ver
        assert chaves == ["analiticos.criar", "analiticos.ver", "membros.ver"]

    def test_adaptador_ida_e_volta(self, db_session):
        grupo = Group(name="G")
        db_session.add(grupo)
        db_session.commit()

        set_legacy_keys_of_group(db_session, grupo.id, ["ia.gerenciar", "analiticos.editar"])
        db_session.commit()
        assert legacy_keys_of_group(db_session, grupo.id) == ["analiticos.editar", "analiticos.ver", "ia.gerenciar"]

        set_legacy_keys_of_group(db_session, grupo.id, [])
        db_session.commit()
        assert legacy_keys_of_group(db_session, grupo.id) == []

    def test_nao_escreve_na_tabela_antiga(self, client, cenario, db_session):
        from app.models.group_permission import GroupPermission

        grupo = self._grupo(client, cenario)
        dar_permissoes_do_grupo(client, cenario["admin"], grupo, ["ia.usar"])
        assert db_session.query(GroupPermission).count() == 0


class TestListasEmSincroniaComOCatalogo:
    def test_itens_de_gerencia_da_ia_sao_os_do_catalogo(self):
        do_catalogo = tuple(p.key for p in CATALOG if p.feature == "ia-gerenciar")
        assert AI_MANAGE_ITEMS == do_catalogo

    def test_todo_item_de_ia_do_catalogo_esta_na_lista(self):
        do_catalogo = {p.key for p in CATALOG if p.key.startswith("ia.")}
        assert set(AI_ITEM_KEYS) == do_catalogo

    def test_toda_rota_testada_usa_um_item_que_existe(self):
        existentes = {p.key for p in CATALOG}
        assert set(CHAVES) <= existentes

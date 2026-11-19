"""Permissoes unificadas, parte 2 da troca da regra: coleções e relatórios passam a ser cobrados pelo item do catálogo.

A prova principal é a matriz: quem tem só um item faz aquilo e mais nada. Corpo vazio nas chamadas de propósito:
se a pessoa passa pela permissão a rota responde 404 ou 422, e se não passa responde 403 antes de olhar o corpo."""

import pytest

from app.core.access_catalog import PRESETS
from app.core.access_roles import EDITOR_CORE

PASSWORD = "SenhaForte123"

# (método, caminho, item exigido); {ws} vira o id da coleção
ROTAS_DE_COLECAO = [
    ("post", "/workspaces/{ws}/reports/", "relatorio.publicar"),
    ("put", "/workspaces/{ws}/reports/1", "relatorio.editar"),
    ("post", "/workspaces/{ws}/reports/1/move", "relatorio.reordenar"),
    ("post", "/workspaces/{ws}/reports/1/thumbnail", "relatorio.miniatura"),
    ("get", "/workspaces/{ws}/reports/1/thumbnail/jobs/x", "relatorio.miniatura"),
    ("delete", "/workspaces/{ws}/reports/1/thumbnail", "relatorio.miniatura"),
    ("delete", "/workspaces/{ws}/reports/1", "relatorio.excluir"),
    ("post", "/workspaces/{ws}/powerbi/reports/1/refresh", "powerbi.atualizar"),
    ("post", "/workspaces/{ws}/powerbi/reports/1/export-email", "relatorio.exportar"),
    ("put", "/workspaces/{ws}", "colecao.editar"),
    ("delete", "/workspaces/{ws}", "colecao.excluir"),
    ("get", "/workspaces/{ws}/audit/", "colecao.auditoria"),
]
CHAVES = sorted({chave for _, _, chave in ROTAS_DE_COLECAO})


def _entrar(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _id_da_pessoa(client, admin, email):
    return next(u["id"] for u in client.get("/users/", headers=admin).json() if u["email"] == email)


@pytest.fixture
def cenario(client):
    admin = _entrar(client, "admin@example.com")
    pessoa = _entrar(client, "pessoa@example.com")
    ws = client.post("/workspaces/", json={"name": "Vendas"}, headers=admin).json()["id"]
    return {"admin": admin, "pessoa": pessoa, "pessoa_id": _id_da_pessoa(client, admin, "pessoa@example.com"), "ws": ws}


def _dar(client, c, blocos):
    resp = client.put(f"/access/users/{c['pessoa_id']}", json={"blocks": blocos}, headers=c["admin"])
    assert resp.status_code == 200, resp.text


def _chamar(client, c, metodo, caminho, quem="pessoa"):
    return client.request(metodo.upper(), caminho.format(ws=c["ws"]), json={}, headers=c[quem])


class TestSemPermissao:
    @pytest.mark.parametrize("metodo,caminho,chave", ROTAS_DE_COLECAO)
    def test_quem_so_ve_a_colecao_recebe_403(self, client, cenario, metodo, caminho, chave):
        # Todo mundo tem leitura pelo grupo padrão: ver não dá nenhuma das ações
        assert _chamar(client, cenario, metodo, caminho).status_code == 403

    @pytest.mark.parametrize("metodo,caminho,chave", ROTAS_DE_COLECAO)
    def test_administrador_da_plataforma_passa_em_todas(self, client, cenario, metodo, caminho, chave):
        if metodo == "delete" and caminho == "/workspaces/{ws}":
            pytest.skip("apagar a coleção é testado à parte")
        assert _chamar(client, cenario, metodo, caminho, quem="admin").status_code != 403


class TestCadaItemFazSoOQueDiz:
    @pytest.mark.parametrize("chave", CHAVES)
    def test_um_item_libera_so_as_rotas_dele(self, client, cenario, chave):
        _dar(client, cenario, [{"workspace_id": cenario["ws"], "permissions": [chave]}])

        for metodo, caminho, exigida in ROTAS_DE_COLECAO:
            if metodo == "delete" and caminho == "/workspaces/{ws}" and exigida == chave:
                continue  # apagar de verdade a coleção encerraria a comparação; coberto em test_excluir_colecao
            status = _chamar(client, cenario, metodo, caminho).status_code
            if exigida == chave:
                assert status != 403, (metodo, caminho)
            else:
                assert status == 403, (metodo, caminho, chave)

    def test_item_dado_em_outra_colecao_nao_vale_aqui(self, client, cenario):
        outra = client.post("/workspaces/", json={"name": "Outra"}, headers=cenario["admin"]).json()["id"]
        _dar(client, cenario, [{"workspace_id": outra, "permissions": ["relatorio.publicar"]}])

        assert _chamar(client, cenario, "post", "/workspaces/{ws}/reports/").status_code == 403
        assert client.post(f"/workspaces/{outra}/reports/", json={}, headers=cenario["pessoa"]).status_code != 403

    def test_permissao_que_vem_de_grupo_vale_igual(self, client, cenario):
        grupo = client.post("/groups/", json={"name": "Time"}, headers=cenario["admin"]).json()["id"]
        client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=cenario["admin"])
        client.put(
            f"/access/groups/{grupo}",
            json={"blocks": [{"workspace_id": cenario["ws"], "permissions": ["relatorio.excluir"]}]},
            headers=cenario["admin"],
        )

        assert _chamar(client, cenario, "delete", "/workspaces/{ws}/reports/1").status_code != 403
        assert _chamar(client, cenario, "put", "/workspaces/{ws}/reports/1").status_code == 403

    def test_excluir_colecao(self, client, cenario):
        _dar(client, cenario, [{"workspace_id": cenario["ws"], "permissions": ["colecao.excluir"]}])
        assert client.delete(f"/workspaces/{cenario['ws']}", headers=cenario["pessoa"]).status_code == 204


class TestQuemJaEraEditorOuAdministradorContinuaIgual:
    """A migração copiou os papéis antigos como atalhos: o que cada papel fazia antes continua valendo."""

    def _grupo_com(self, client, c, chaves):
        grupo = client.post("/groups/", json={"name": "G"}, headers=c["admin"]).json()["id"]
        client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=c["admin"])
        client.put(f"/access/groups/{grupo}", json={"blocks": [{"workspace_id": c["ws"], "permissions": chaves}]}, headers=c["admin"])

    def test_editor_faz_o_que_o_editor_sempre_fez_e_so_isso(self, client, cenario):
        self._grupo_com(client, cenario, list(PRESETS["editor"]))
        for metodo, caminho, exigida in ROTAS_DE_COLECAO:
            esperado_livre = exigida in EDITOR_CORE
            status = _chamar(client, cenario, metodo, caminho).status_code
            assert (status != 403) == esperado_livre, (metodo, caminho)

    def test_administrador_da_colecao_edita_exclui_e_ve_a_auditoria_mas_nao_exporta(self, client, cenario):
        self._grupo_com(client, cenario, list(PRESETS["administrador"]))
        for metodo, caminho, exigida in ROTAS_DE_COLECAO:
            if metodo == "delete" and caminho == "/workspaces/{ws}":
                continue
            status = _chamar(client, cenario, metodo, caminho).status_code
            if exigida == "relatorio.exportar":
                # Exportar por e-mail era só do administrador da plataforma e continua assim, até alguém ligar o item
                assert status == 403
            else:
                assert status != 403, (metodo, caminho)


class TestRotasGlobaisDeColecao:
    def test_ver_todas_as_colecoes(self, client, cenario):
        assert client.get("/workspaces/all", headers=cenario["pessoa"]).status_code == 403
        _dar(client, cenario, [{"workspace_id": None, "permissions": ["colecao.todas"]}])
        resp = client.get("/workspaces/all", headers=cenario["pessoa"])
        assert resp.status_code == 200 and [w["name"] for w in resp.json()] == ["Vendas"]

    def test_criar_colecao_exige_o_item_e_quem_cria_vira_administrador_dela(self, client, cenario):
        assert client.post("/workspaces/", json={"name": "Nova"}, headers=cenario["pessoa"]).status_code == 403

        _dar(client, cenario, [{"workspace_id": None, "permissions": ["colecao.criar"]}])
        resp = client.post("/workspaces/", json={"name": "Nova"}, headers=cenario["pessoa"])
        assert resp.status_code == 201
        nova = resp.json()["id"]

        meus_papeis = {w["id"]: w["role"] for w in client.get("/workspaces/", headers=cenario["pessoa"]).json()}
        assert meus_papeis[nova] == "admin"
        # Administra a que criou, não as outras
        assert client.put(f"/workspaces/{nova}", json={"name": "Nova 2"}, headers=cenario["pessoa"]).status_code == 200
        assert client.put(f"/workspaces/{cenario['ws']}", json={"name": "X"}, headers=cenario["pessoa"]).status_code == 403

    def test_criar_colecao_pelo_administrador_nao_cria_permissao_avulsa_para_ele(self, client, cenario, db_session):
        from app.models.access_grant import AccessGrant

        client.post("/workspaces/", json={"name": "Nova"}, headers=cenario["admin"])
        assert db_session.query(AccessGrant).filter(AccessGrant.user_id.isnot(None)).count() == 0


class TestCatalogoDoPowerBi:
    CAMINHO = "/powerbi/connections/1/workspaces"

    def test_leitor_nao_lista_o_power_bi(self, client, cenario):
        assert client.get(self.CAMINHO, headers=cenario["pessoa"]).status_code == 403

    @pytest.mark.parametrize("chave", ["relatorio.publicar", "relatorio.editar"])
    def test_publicar_ou_editar_em_alguma_colecao_basta(self, client, cenario, chave):
        _dar(client, cenario, [{"workspace_id": cenario["ws"], "permissions": [chave]}])
        assert client.get(self.CAMINHO, headers=cenario["pessoa"]).status_code != 403

    def test_outras_permissoes_de_colecao_nao_bastam(self, client, cenario):
        _dar(client, cenario, [{"workspace_id": cenario["ws"], "permissions": ["relatorio.excluir", "assinatura.criar"]}])
        assert client.get(self.CAMINHO, headers=cenario["pessoa"]).status_code == 403

"""Permissoes unificadas, parte 3 da troca da regra: assinaturas por e-mail e alertas passam a ser cobrados pelo item do
catálogo. Mesma prova da parte 2: quem tem só um item faz aquilo e o que ele exige (criar assinatura exige ver as
assinaturas), e mais nada. Corpo vazio de propósito: sem permissão a rota responde 403 antes de olhar o corpo."""

import pytest

from app.core.access_catalog import PRESETS, with_implied

PASSWORD = "SenhaForte123"

# (método, caminho, item exigido); {ws} vira o id da coleção
ROTAS = [
    ("get", "/workspaces/{ws}/subscriptions", "assinatura.ver"),
    ("get", "/workspaces/{ws}/reports/1/subscriptions", "assinatura.ver"),
    ("post", "/workspaces/{ws}/reports/1/subscriptions", "assinatura.criar"),
    ("get", "/workspaces/{ws}/subscriptions/1", "assinatura.ver"),
    ("put", "/workspaces/{ws}/subscriptions/1", "assinatura.editar"),
    ("delete", "/workspaces/{ws}/subscriptions/1", "assinatura.excluir"),
    ("post", "/workspaces/{ws}/subscriptions/1/run", "assinatura.executar"),
    ("get", "/workspaces/{ws}/subscriptions/1/runs", "assinatura.ver"),
    ("get", "/workspaces/{ws}/reports/1/alerts", "alerta.ver"),
    ("get", "/workspaces/{ws}/reports/1/measures", "alerta.ver"),
    ("post", "/workspaces/{ws}/reports/1/alerts", "alerta.criar"),
    ("put", "/workspaces/{ws}/alerts/1", "alerta.editar"),
    ("delete", "/workspaces/{ws}/alerts/1", "alerta.excluir"),
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
    ws = client.post("/workspaces/", json={"name": "Vendas"}, headers=admin).json()["id"]
    pessoa_id = next(u["id"] for u in client.get("/users/", headers=admin).json() if u["email"] == "pessoa@example.com")
    return {"admin": admin, "pessoa": pessoa, "pessoa_id": pessoa_id, "ws": ws}


def _dar(client, c, chaves):
    resp = client.put(
        f"/access/users/{c['pessoa_id']}",
        json={"blocks": [{"workspace_id": c["ws"], "permissions": chaves}]},
        headers=c["admin"],
    )
    assert resp.status_code == 200, resp.text


def _chamar(client, c, metodo, caminho, quem="pessoa"):
    return client.request(metodo.upper(), caminho.format(ws=c["ws"]), json={}, headers=c[quem])


class TestSemPermissao:
    @pytest.mark.parametrize("metodo,caminho,chave", ROTAS)
    def test_quem_so_ve_a_colecao_recebe_403(self, client, cenario, metodo, caminho, chave):
        assert _chamar(client, cenario, metodo, caminho).status_code == 403

    @pytest.mark.parametrize("metodo,caminho,chave", ROTAS)
    def test_administrador_da_plataforma_passa_em_todas(self, client, cenario, metodo, caminho, chave):
        assert _chamar(client, cenario, metodo, caminho, quem="admin").status_code != 403


class TestCadaItemFazSoOQueDiz:
    @pytest.mark.parametrize("chave", CHAVES)
    def test_um_item_libera_so_as_rotas_dele_e_as_do_que_ele_exige(self, client, cenario, chave):
        _dar(client, cenario, [chave])
        liberadas = set(with_implied([chave]))

        for metodo, caminho, exigida in ROTAS:
            status = _chamar(client, cenario, metodo, caminho).status_code
            if exigida in liberadas:
                assert status != 403, (metodo, caminho)
            else:
                assert status == 403, (metodo, caminho, chave)

    def test_assinatura_e_alerta_sao_independentes(self, client, cenario):
        _dar(client, cenario, ["assinatura.criar", "assinatura.editar", "assinatura.excluir", "assinatura.executar"])
        assert _chamar(client, cenario, "get", "/workspaces/{ws}/reports/1/alerts").status_code == 403

        _dar(client, cenario, ["alerta.criar"])
        assert _chamar(client, cenario, "get", "/workspaces/{ws}/subscriptions").status_code == 403

    def test_item_dado_em_outra_colecao_nao_vale_aqui(self, client, cenario):
        outra = client.post("/workspaces/", json={"name": "Outra"}, headers=cenario["admin"]).json()["id"]
        client.put(
            f"/access/users/{cenario['pessoa_id']}",
            json={"blocks": [{"workspace_id": outra, "permissions": ["assinatura.ver", "alerta.ver"]}]},
            headers=cenario["admin"],
        )

        assert _chamar(client, cenario, "get", "/workspaces/{ws}/subscriptions").status_code == 403
        assert client.get(f"/workspaces/{outra}/subscriptions", headers=cenario["pessoa"]).status_code == 200
        assert client.get(f"/workspaces/{outra}/reports/1/alerts", headers=cenario["pessoa"]).status_code != 403


class TestQuemJaEraEditorOuAdministradorContinuaIgual:
    def _grupo_com(self, client, c, chaves):
        grupo = client.post("/groups/", json={"name": "G"}, headers=c["admin"]).json()["id"]
        client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=c["admin"])
        client.put(f"/access/groups/{grupo}", json={"blocks": [{"workspace_id": c["ws"], "permissions": chaves}]}, headers=c["admin"])

    def test_editor_continua_com_tudo_de_assinaturas_e_alertas(self, client, cenario):
        self._grupo_com(client, cenario, list(PRESETS["editor"]))
        for metodo, caminho, _ in ROTAS:
            assert _chamar(client, cenario, metodo, caminho).status_code != 403, (metodo, caminho)

    def test_leitor_continua_sem_nada(self, client, cenario):
        self._grupo_com(client, cenario, list(PRESETS["leitor"]))
        for metodo, caminho, _ in ROTAS:
            assert _chamar(client, cenario, metodo, caminho).status_code == 403, (metodo, caminho)


class TestListaDeDominios:
    """A regra "sem lista de domínios, só quem pode enviar para qualquer domínio cria" é provada de ponta a ponta em
    test_subscriptions_api.py; aqui fica só o que os atalhos da tela ligam."""

    def test_atalho_administrador_da_colecao_inclui_qualquer_dominio_e_o_editor_nao(self):
        assert "assinatura.qualquer-dominio" in PRESETS["administrador"]
        assert "assinatura.qualquer-dominio" not in PRESETS["editor"]


class TestVisaoDoPortalTodo:
    def test_ver_as_assinaturas_de_todas_as_colecoes(self, client, cenario):
        assert client.get("/subscriptions/", headers=cenario["pessoa"]).status_code == 403

        client.put(
            f"/access/users/{cenario['pessoa_id']}",
            json={"blocks": [{"workspace_id": None, "permissions": ["assinatura.todas"]}]},
            headers=cenario["admin"],
        )
        assert client.get("/subscriptions/", headers=cenario["pessoa"]).status_code == 200

    def test_ver_assinaturas_numa_colecao_nao_da_a_visao_do_portal(self, client, cenario):
        _dar(client, cenario, ["assinatura.ver"])
        assert client.get("/subscriptions/", headers=cenario["pessoa"]).status_code == 403

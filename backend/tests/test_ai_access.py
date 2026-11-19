"""Permissoes de IA por grupo: quem gerencia a IA e quem usa o chat. A permissao vem dos grupos
(uniao de todos os da pessoa), o grupo Administradores tem tudo sempre, e so o admin da
plataforma concede."""

import pytest

from app.models.access_grant import AccessGrant
from tests.access_helpers import dar_permissoes_do_grupo

PASSWORD = "SenhaForte123"


def _headers(client, email: str) -> dict:
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(client):
    return _headers(client, "admin@example.com")  # a primeira conta cadastrada e administradora


@pytest.fixture
def pessoa(client, admin):
    return _headers(client, "pessoa@example.com")


def _novo_grupo(client, admin, nome="Comercial") -> int:
    return client.post("/groups/", json={"name": nome}, headers=admin).json()["id"]


def _colocar(client, admin, grupo_id: int, email: str = "pessoa@example.com"):
    resp = client.post(f"/groups/{grupo_id}/members", json={"email": email}, headers=admin)
    assert resp.status_code == 201


def _permissoes(client, admin, grupo_id: int, chaves: list[str]):
    return dar_permissoes_do_grupo(client, admin, grupo_id, chaves)


def _acesso(client, headers) -> dict:
    # Só os dois resumos de sempre; a lista de itens (permissions) tem os seus testes em test_access_parte4.py
    dados = client.get("/ai/access", headers=headers).json()
    return {"can_manage": dados["can_manage"], "can_use": dados["can_use"]}


def _grupo_especial(client, admin, campo: str) -> int:
    return next(g["id"] for g in client.get("/groups/", headers=admin).json() if g[campo])


class TestAcesso:
    def test_exige_estar_logado(self, client):
        assert client.get("/ai/access").status_code == 401

    def test_administrador_tem_as_duas_sempre(self, client, admin):
        assert _acesso(client, admin) == {"can_manage": True, "can_use": True}

    def test_pessoa_comum_sem_grupo_com_permissao_nao_tem_nenhuma(self, client, pessoa):
        assert _acesso(client, pessoa) == {"can_manage": False, "can_use": False}

    def test_so_usar_nao_da_gerenciar(self, client, admin, pessoa):
        grupo = _novo_grupo(client, admin)
        _colocar(client, admin, grupo)
        _permissoes(client, admin, grupo, ["ia.usar"])

        assert _acesso(client, pessoa) == {"can_manage": False, "can_use": True}

    def test_so_gerenciar_nao_da_usar(self, client, admin, pessoa):
        grupo = _novo_grupo(client, admin)
        _colocar(client, admin, grupo)
        _permissoes(client, admin, grupo, ["ia.gerenciar"])

        assert _acesso(client, pessoa) == {"can_manage": True, "can_use": False}

    def test_a_pessoa_recebe_a_uniao_dos_grupos_dela(self, client, admin, pessoa):
        grupo_a = _novo_grupo(client, admin, "Grupo A")
        grupo_b = _novo_grupo(client, admin, "Grupo B")
        for grupo in (grupo_a, grupo_b):
            _colocar(client, admin, grupo)
        _permissoes(client, admin, grupo_a, ["ia.usar"])
        _permissoes(client, admin, grupo_b, ["ia.gerenciar"])

        assert _acesso(client, pessoa) == {"can_manage": True, "can_use": True}

    def test_permissao_de_grupo_onde_a_pessoa_nao_esta_nao_vale(self, client, admin, pessoa):
        grupo = _novo_grupo(client, admin)
        _permissoes(client, admin, grupo, ["ia.usar", "ia.gerenciar"])

        assert _acesso(client, pessoa) == {"can_manage": False, "can_use": False}

    def test_revogar_tira_o_acesso_na_proxima_requisicao(self, client, admin, pessoa):
        grupo = _novo_grupo(client, admin)
        _colocar(client, admin, grupo)
        _permissoes(client, admin, grupo, ["ia.usar"])
        assert _acesso(client, pessoa)["can_use"] is True

        _permissoes(client, admin, grupo, [])

        assert _acesso(client, pessoa)["can_use"] is False

    def test_sair_do_grupo_tira_o_acesso(self, client, admin, pessoa):
        grupo = _novo_grupo(client, admin)
        _colocar(client, admin, grupo)
        _permissoes(client, admin, grupo, ["ia.usar"])
        usuario_id = client.get(f"/groups/{grupo}/members", headers=admin).json()[0]["user_id"]

        client.delete(f"/groups/{grupo}/members/{usuario_id}", headers=admin)

        assert _acesso(client, pessoa)["can_use"] is False

    def test_liberar_no_grupo_todos_os_usuarios_vale_para_todo_mundo_inclusive_quem_entra_depois(self, client, admin, pessoa):
        todos = _grupo_especial(client, admin, "is_default")
        _permissoes(client, admin, todos, ["ia.usar"])

        novo = _headers(client, "novo@example.com")

        assert _acesso(client, pessoa)["can_use"] is True
        assert _acesso(client, novo)["can_use"] is True
        assert _acesso(client, novo)["can_manage"] is False


class TestRotaDeConfiguracaoDeIA:
    def test_quem_so_usa_nao_entra_na_configuracao(self, client, admin, pessoa):
        grupo = _novo_grupo(client, admin)
        _colocar(client, admin, grupo)
        _permissoes(client, admin, grupo, ["ia.usar"])

        assert client.get("/settings/ai/", headers=pessoa).status_code == 403
        assert client.put("/settings/ai/openai", json={"model": "x"}, headers=pessoa).status_code == 403
        assert client.post("/settings/ai/openai/test", headers=pessoa).status_code == 403

    def test_quem_gerencia_le_grava_e_testa_sem_ser_administrador(self, client, admin, pessoa):
        grupo = _novo_grupo(client, admin)
        _colocar(client, admin, grupo)
        _permissoes(client, admin, grupo, ["ia.gerenciar"])

        assert client.get("/settings/ai/", headers=pessoa).status_code == 200
        gravou = client.put("/settings/ai/openai", json={"api_key": "chave-1", "model": "gpt-x"}, headers=pessoa)
        assert gravou.status_code == 200 and gravou.json()["api_key_configured"] is True
        # chegou na regra de negocio (chave salva), nao foi barrado por permissao
        assert client.post("/settings/ai/anthropic/test", headers=pessoa).status_code == 400

    def test_a_mensagem_de_recusa_e_clara(self, client, pessoa):
        resp = client.get("/settings/ai/", headers=pessoa)

        assert resp.status_code == 403
        assert "permissao" in resp.json()["detail"]

    def test_revogar_gerenciar_fecha_a_configuracao(self, client, admin, pessoa):
        grupo = _novo_grupo(client, admin)
        _colocar(client, admin, grupo)
        _permissoes(client, admin, grupo, ["ia.gerenciar"])
        assert client.get("/settings/ai/", headers=pessoa).status_code == 200

        _permissoes(client, admin, grupo, [])

        assert client.get("/settings/ai/", headers=pessoa).status_code == 403


class TestExcluirGrupo:
    def test_apagar_o_grupo_apaga_as_permissoes_e_o_acesso(self, client, admin, pessoa, db_session):
        grupo = _novo_grupo(client, admin)
        _colocar(client, admin, grupo)
        _permissoes(client, admin, grupo, ["ia.usar", "ia.gerenciar"])

        assert client.delete(f"/groups/{grupo}", headers=admin).status_code == 204

        assert db_session.query(AccessGrant).filter(AccessGrant.group_id == grupo).count() == 0
        assert _acesso(client, pessoa) == {"can_manage": False, "can_use": False}

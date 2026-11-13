"""Permissoes de analiticos por grupo: ver, criar, editar e excluir visuais do painel."""

import pytest

from app.core.audit_dashboard import default_widgets, required_permissions

PASSWORD = "SenhaForte123"


def _headers(client, email: str) -> dict:
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(client):
    return _headers(client, "admin@example.com")


@pytest.fixture
def pessoa(client, admin):
    return _headers(client, "pessoa@example.com")


def _dar(client, admin, chaves: list[str]):
    grupo = client.post("/groups/", json={"name": "Analise"}, headers=admin).json()["id"]
    client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=admin)
    resp = client.put(f"/groups/{grupo}/permissions", json={"permissions": chaves}, headers=admin)
    assert resp.status_code == 200
    return resp.json()["permissions"]


def _acesso(client, headers) -> dict:
    return client.get("/analytics/access", headers=headers).json()


def _painel(client, headers) -> dict:
    return client.get("/audit/dashboard", headers=headers).json()


class TestAcesso:
    def test_exige_login(self, client):
        assert client.get("/analytics/access").status_code == 401

    def test_admin_tem_tudo(self, client, admin):
        assert _acesso(client, admin) == {"can_view": True, "can_create": True, "can_edit": True, "can_delete": True}

    def test_pessoa_sem_permissao_nao_ve_nada(self, client, pessoa):
        assert _acesso(client, pessoa)["can_view"] is False
        assert client.get("/audit/dashboard", headers=pessoa).status_code == 403
        assert client.get("/audit/summary", headers=pessoa).status_code == 403
        assert client.get("/audit/query", params={"metric": "events"}, headers=pessoa).status_code == 403

    def test_criar_implica_ver(self, client, admin, pessoa):
        assert "analiticos.ver" in _dar(client, admin, ["analiticos.criar"])
        acesso = _acesso(client, pessoa)
        assert acesso["can_view"] and acesso["can_create"] and not acesso["can_edit"]

    def test_chave_desconhecida_e_recusada(self, client, admin):
        grupo = client.post("/groups/", json={"name": "X"}, headers=admin).json()["id"]
        resp = client.put(f"/groups/{grupo}/permissions", json={"permissions": ["analiticos.tudo"]}, headers=admin)
        assert resp.status_code == 422


class TestVer:
    def test_leitor_ve_sem_emails(self, client, admin, pessoa):
        _dar(client, admin, ["analiticos.ver"])
        assert client.get("/audit/dashboard", headers=pessoa).status_code == 200
        resumo = client.get("/audit/summary", headers=pessoa).json()
        assert all(u["email"] is None for u in resumo["top_users"])
        opcoes = client.get("/audit/options", headers=pessoa).json()
        assert all(not p["email"] for p in opcoes["users"])
        consulta = client.get("/audit/query", params={"metric": "events", "group_by": "user"}, headers=pessoa)
        assert consulta.status_code == 200
        assert all("@" not in r["label"] for r in consulta.json()["rows"])

    def test_leitor_nao_acessa_a_tabela_da_auditoria(self, client, admin, pessoa):
        _dar(client, admin, ["analiticos.ver"])
        assert client.get("/audit", headers=pessoa).status_code in (403, 404)


class TestSalvar:
    def _widgets(self, client, admin):
        return _painel(client, admin)["widgets"]

    def _salvar(self, client, headers, widgets):
        return client.put("/audit/dashboard", json={"widgets": widgets}, headers=headers)

    def _novo(self):
        return {
            "id": "custom-1", "type": "stat", "source": "custom", "title": "Meu", "color": None,
            "query": {"metric": "events", "group_by": "none", "limit": 8}, "x": 0, "y": 40, "w": 4, "h": 2,
        }

    def test_so_ver_nao_salva(self, client, admin, pessoa):
        _dar(client, admin, ["analiticos.ver"])
        widgets = self._widgets(client, admin)
        resp = self._salvar(client, pessoa, widgets + [self._novo()])
        assert resp.status_code == 403
        assert "criar" in resp.json()["detail"]

    def test_criar_permite_adicionar_mas_nao_remover(self, client, admin, pessoa):
        _dar(client, admin, ["analiticos.criar"])
        widgets = self._widgets(client, admin)
        assert self._salvar(client, pessoa, widgets + [self._novo()]).status_code == 200
        assert self._salvar(client, pessoa, widgets[1:]).status_code == 403

    def test_excluir_permite_remover(self, client, admin, pessoa):
        _dar(client, admin, ["analiticos.excluir"])
        widgets = self._widgets(client, admin)
        assert self._salvar(client, pessoa, widgets[1:]).status_code == 200

    def test_editar_permite_mover_e_trocar_titulo(self, client, admin, pessoa):
        _dar(client, admin, ["analiticos.editar"])
        widgets = self._widgets(client, admin)
        widgets[0] = {**widgets[0], "title": "Novo titulo"}
        widgets[1] = {**widgets[1], "x": 4, "y": 30}
        assert self._salvar(client, pessoa, widgets).status_code == 200

    def test_salvar_sem_mudanca_nao_grava(self, client, admin, pessoa):
        _dar(client, admin, ["analiticos.ver"])
        resp = self._salvar(client, pessoa, self._widgets(client, admin))
        assert resp.status_code == 200
        assert resp.json()["is_default"] is True

    def test_restaurar_padrao_pede_as_tres(self, client, admin, pessoa):
        _dar(client, admin, ["analiticos.criar", "analiticos.editar"])
        assert client.delete("/audit/dashboard", headers=pessoa).status_code == 403
        assert client.delete("/audit/dashboard", headers=admin).status_code == 200


class TestDiferenca:
    def test_regras(self):
        base = default_widgets()
        assert required_permissions(base, base) == set()
        moved = [{**base[0], "x": 3}] + base[1:]
        assert required_permissions(base, moved) == {"analiticos.editar"}
        assert required_permissions(base, base[1:]) == {"analiticos.excluir"}
        reflow = [{**w, "y": w["y"] + 1} for w in base[1:]]
        assert required_permissions(base, reflow) == {"analiticos.excluir"}

    def test_trocar_o_filtro_de_um_visual_pede_editar(self):
        def visual(filters):
            query = {"metric": "logins", "group_by": "none", "limit": 8, "filters": filters}
            return {"id": "c1", "type": "stat", "source": "custom", "title": None, "color": None, "query": query,
                    "x": 0, "y": 0, "w": 4, "h": 2}

        sem = [visual(None)]
        com = [visual({"action": ["login"]})]
        assert required_permissions(sem, com) == {"analiticos.editar"}
        assert required_permissions(com, com) == set()

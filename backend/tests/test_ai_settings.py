"""Rotas de configuracao dos provedores de IA: so administradores, a chave nunca sai pela API
e nunca e gravada em texto claro, e o teste de chamada usa o contrato HTTP real."""

import json
from unittest.mock import patch

import httpx
import pytest
from sqlalchemy import text

from app.core import ai_providers
from app.core.ai_providers import AIError, AIResult
from app.models.ai_provider import AIProvider
from app.models.audit_log import AuditLog

PASSWORD = "SenhaForte123"
CHAVE = "chave-ficticia-de-teste-abc123"


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


def _salvar(client, admin, provedor="openrouter", **extra):
    corpo = {"api_key": CHAVE, "model": "openai/gpt-4o-mini", **extra}
    return client.put(f"/settings/ai/{provedor}", json=corpo, headers=admin)


class TestPermissao:
    def test_tudo_exige_estar_logado(self, client):
        assert client.get("/settings/ai/").status_code == 401
        assert client.put("/settings/ai/openai", json={"model": "x"}).status_code == 401
        assert client.post("/settings/ai/openai/test").status_code == 401

    def test_quem_nao_e_administrador_nao_le_nem_grava_nem_testa(self, client, pessoa):
        assert client.get("/settings/ai/", headers=pessoa).status_code == 403
        assert client.put("/settings/ai/openai", json={"api_key": CHAVE}, headers=pessoa).status_code == 403
        assert client.post("/settings/ai/openai/test", headers=pessoa).status_code == 403

    def test_a_rota_publica_de_configuracoes_nao_mostra_nada_de_ia(self, client, admin):
        _salvar(client, admin)

        publica = client.get("/settings/")

        assert publica.status_code == 200
        assert CHAVE not in publica.text
        assert "openrouter" not in publica.text


class TestListagem:
    def test_lista_os_cinco_provedores_na_ordem_do_catalogo_mesmo_sem_nada_salvo(self, client, admin):
        resp = client.get("/settings/ai/", headers=admin)

        assert resp.status_code == 200
        corpo = resp.json()
        assert [p["provider"] for p in corpo] == ["openai", "gemini", "anthropic", "openrouter", "nvidia"]
        assert all(p["api_key_configured"] is False and p["enabled"] is False and p["model"] is None for p in corpo)
        assert all(p["label"] and p["example_model"] for p in corpo)

    def test_mostra_o_que_foi_salvo_so_no_provedor_certo(self, client, admin):
        _salvar(client, admin, "anthropic", model="claude-x")

        por_provedor = {p["provider"]: p for p in client.get("/settings/ai/", headers=admin).json()}

        assert por_provedor["anthropic"]["api_key_configured"] is True
        assert por_provedor["anthropic"]["model"] == "claude-x"
        assert por_provedor["openai"]["api_key_configured"] is False


class TestChave:
    def test_a_chave_nunca_volta_pela_api_so_um_aviso_de_que_existe(self, client, admin):
        resp = _salvar(client, admin)

        assert resp.status_code == 200
        assert resp.json()["api_key_configured"] is True
        assert CHAVE not in resp.text
        assert "api_key" not in resp.json()
        assert CHAVE not in client.get("/settings/ai/", headers=admin).text

    def test_a_chave_fica_cifrada_no_banco(self, client, admin, db_session):
        _salvar(client, admin)

        bruto = db_session.execute(text("SELECT api_key FROM ai_providers WHERE provider = 'openrouter'")).scalar()
        assert bruto and CHAVE not in bruto
        assert db_session.query(AIProvider).first().api_key == CHAVE

    def test_salvar_so_o_modelo_mantem_a_chave(self, client, admin, db_session):
        _salvar(client, admin)

        resp = client.put("/settings/ai/openrouter", json={"model": "outro/modelo"}, headers=admin)

        assert resp.json()["api_key_configured"] is True
        assert resp.json()["model"] == "outro/modelo"
        assert db_session.query(AIProvider).first().api_key == CHAVE

    def test_trocar_a_chave(self, client, admin, db_session):
        _salvar(client, admin)

        client.put("/settings/ai/openrouter", json={"api_key": "chave-nova"}, headers=admin)

        db_session.expire_all()
        assert db_session.query(AIProvider).first().api_key == "chave-nova"

    def test_texto_vazio_apaga_a_chave_e_desativa_o_provedor(self, client, admin):
        _salvar(client, admin, enabled=True)

        resp = client.put("/settings/ai/openrouter", json={"api_key": ""}, headers=admin)

        assert resp.json()["api_key_configured"] is False
        assert resp.json()["enabled"] is False

    def test_espacos_em_volta_da_chave_colada_sao_tirados(self, client, admin, db_session):
        client.put("/settings/ai/openai", json={"api_key": f"  {CHAVE}  "}, headers=admin)

        assert db_session.query(AIProvider).first().api_key == CHAVE

    @pytest.mark.parametrize("chave", ["com espaco no meio", "com\nquebra", "acentuaçao"])
    def test_chave_com_caracteres_que_quebrariam_o_cabecalho_e_recusada(self, client, admin, chave):
        resp = client.put("/settings/ai/openai", json={"api_key": chave}, headers=admin)

        assert resp.status_code == 422

    def test_cada_provedor_guarda_a_propria_chave(self, client, admin, db_session):
        _salvar(client, admin, "openai", api_key="chave-openai")
        _salvar(client, admin, "gemini", api_key="chave-gemini")

        chaves = {r.provider: r.api_key for r in db_session.query(AIProvider).all()}
        assert chaves == {"openai": "chave-openai", "gemini": "chave-gemini"}


class TestAtivar:
    def test_nao_ativa_sem_chave(self, client, admin):
        resp = client.put("/settings/ai/openai", json={"model": "gpt-x", "enabled": True}, headers=admin)

        assert resp.status_code == 400
        assert "chave e o modelo" in resp.json()["detail"]
        assert client.get("/settings/ai/", headers=admin).json()[0]["enabled"] is False

    def test_nao_ativa_sem_modelo(self, client, admin):
        resp = client.put("/settings/ai/openai", json={"api_key": CHAVE, "enabled": True}, headers=admin)

        assert resp.status_code == 400

    def test_ativa_e_desativa_com_chave_e_modelo(self, client, admin):
        assert _salvar(client, admin, enabled=True).json()["enabled"] is True
        assert client.put("/settings/ai/openrouter", json={"enabled": False}, headers=admin).json()["enabled"] is False

    def test_a_recusa_de_ativar_nao_deixa_a_chave_gravada_pela_metade(self, client, admin):
        client.put("/settings/ai/openai", json={"api_key": CHAVE, "enabled": True}, headers=admin)

        # O pedido inteiro foi recusado: nada dele fica no banco
        assert client.get("/settings/ai/", headers=admin).json()[0]["api_key_configured"] is False


class TestValidacao:
    def test_provedor_desconhecido(self, client, admin):
        assert client.put("/settings/ai/inexistente", json={"model": "x"}, headers=admin).status_code == 404
        assert client.post("/settings/ai/inexistente/test", headers=admin).status_code == 404

    def test_modelo_vazio_vira_nulo(self, client, admin):
        _salvar(client, admin)

        resp = client.put("/settings/ai/openrouter", json={"model": "  "}, headers=admin)

        assert resp.json()["model"] is None

    def test_chave_longa_demais_e_recusada(self, client, admin):
        assert client.put("/settings/ai/openai", json={"api_key": "a" * 501}, headers=admin).status_code == 422


class TestProvedorDoChat:
    def _padrao(self, client, admin) -> list[str]:
        return [p["provider"] for p in client.get("/settings/ai/", headers=admin).json() if p["chat_default"]]

    def test_ninguem_e_padrao_no_comeco(self, client, admin):
        assert self._padrao(client, admin) == []

    def test_escolher_exige_o_provedor_ativo(self, client, admin):
        _salvar(client, admin)  # com chave e modelo, mas ainda nao ativo

        resp = client.put("/settings/ai/openrouter", json={"chat_default": True}, headers=admin)

        assert resp.status_code == 400
        assert "Ative o provedor" in resp.json()["detail"]
        assert self._padrao(client, admin) == []

    def test_ativar_e_escolher_no_mesmo_pedido(self, client, admin):
        resp = _salvar(client, admin, enabled=True, chat_default=True)

        assert resp.status_code == 200
        assert (resp.json()["enabled"], resp.json()["chat_default"]) == (True, True)

    def test_escolher_um_tira_a_marca_do_outro(self, client, admin):
        _salvar(client, admin, "openai", enabled=True, chat_default=True)
        _salvar(client, admin, "gemini", enabled=True, chat_default=True)

        assert self._padrao(client, admin) == ["gemini"]

    def test_a_recusa_de_escolher_nao_tira_a_marca_de_quem_ja_era(self, client, admin):
        _salvar(client, admin, "openai", enabled=True, chat_default=True)
        _salvar(client, admin, "gemini")  # nao ativo

        client.put("/settings/ai/gemini", json={"chat_default": True}, headers=admin)

        assert self._padrao(client, admin) == ["openai"]

    def test_desmarcar(self, client, admin):
        _salvar(client, admin, enabled=True, chat_default=True)

        resp = client.put("/settings/ai/openrouter", json={"chat_default": False}, headers=admin)

        assert resp.json()["chat_default"] is False and resp.json()["enabled"] is True

    def test_desativar_o_provedor_tira_do_chat(self, client, admin):
        _salvar(client, admin, enabled=True, chat_default=True)

        resp = client.put("/settings/ai/openrouter", json={"enabled": False}, headers=admin)

        assert (resp.json()["enabled"], resp.json()["chat_default"]) == (False, False)

    def test_apagar_a_chave_tira_do_chat(self, client, admin):
        _salvar(client, admin, enabled=True, chat_default=True)

        resp = client.put("/settings/ai/openrouter", json={"api_key": ""}, headers=admin)

        assert resp.json()["chat_default"] is False

    def test_reativar_nao_devolve_a_escolha_sozinho(self, client, admin):
        _salvar(client, admin, enabled=True, chat_default=True)
        client.put("/settings/ai/openrouter", json={"enabled": False}, headers=admin)

        resp = client.put("/settings/ai/openrouter", json={"enabled": True}, headers=admin)

        assert resp.json()["chat_default"] is False

    def test_salvar_outros_campos_mantem_a_escolha(self, client, admin):
        _salvar(client, admin, enabled=True, chat_default=True)

        resp = client.put("/settings/ai/openrouter", json={"model": "outro/modelo"}, headers=admin)

        assert resp.json()["chat_default"] is True

    def test_quem_so_gerencia_a_ia_tambem_escolhe(self, client, admin, pessoa):
        grupo = client.post("/groups/", json={"name": "Gestores"}, headers=admin).json()["id"]
        client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=admin)
        client.put(f"/groups/{grupo}/permissions", json={"permissions": ["ia.gerenciar"]}, headers=admin)

        resp = _salvar(client, pessoa, enabled=True, chat_default=True)

        assert resp.status_code == 200 and resp.json()["chat_default"] is True


class TestAuditoria:
    def test_alterar_registra_so_os_nomes_dos_campos(self, client, admin, db_session):
        _salvar(client, admin)

        log = db_session.query(AuditLog).filter(AuditLog.action == "update_ai_provider").one()
        assert log.entity_id == "openrouter"
        assert "api_key" in log.details and "model" in log.details
        for valor in (CHAVE, "openai/gpt-4o-mini"):
            assert valor not in log.details


class TestTeste:
    def test_sem_salvar_a_chave_e_o_modelo_pede_para_salvar(self, client, admin):
        resp = client.post("/settings/ai/openai/test", headers=admin)

        assert resp.status_code == 400
        assert "Salve a chave e o modelo" in resp.json()["detail"]

    def test_chamada_de_teste_usa_a_chave_e_o_modelo_salvos(self, client, admin, db_session):
        _salvar(client, admin)

        with patch.object(ai_providers, "complete", return_value=AIResult("ok", 5, 1)) as chamar:
            resp = client.post("/settings/ai/openrouter/test", headers=admin)

        assert resp.status_code == 200
        corpo = resp.json()
        assert corpo["ok"] is True and corpo["model"] == "openai/gpt-4o-mini" and corpo["latency_ms"] >= 0
        assert chamar.call_args.args[:3] == ("openrouter", CHAVE, "openai/gpt-4o-mini")
        assert db_session.query(AuditLog).filter(AuditLog.action == "test_ai_provider").count() == 1

    def test_o_contrato_http_de_verdade_leva_a_chave_no_cabecalho(self, client, admin, monkeypatch):
        """Sem simular a funcao de chamada: o que sai pela rede e o que vale."""
        vistas = []

        def handler(request: httpx.Request) -> httpx.Response:
            vistas.append(request)
            return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

        monkeypatch.setattr(ai_providers, "_http", httpx.Client(transport=httpx.MockTransport(handler)))
        _salvar(client, admin, "openrouter")

        resp = client.post("/settings/ai/openrouter/test", headers=admin)

        assert resp.status_code == 200
        assert str(vistas[0].url) == "https://openrouter.ai/api/v1/chat/completions"
        assert vistas[0].headers["authorization"] == f"Bearer {CHAVE}"
        assert json.loads(vistas[0].content)["model"] == "openai/gpt-4o-mini"
        assert CHAVE not in resp.text

    def test_falha_do_provedor_vira_502_com_mensagem_clara_sem_a_chave(self, client, admin):
        _salvar(client, admin)

        with patch.object(ai_providers, "complete", side_effect=AIError("O provedor recusou a chave de API.")):
            resp = client.post("/settings/ai/openrouter/test", headers=admin)

        assert resp.status_code == 502
        assert "recusou a chave" in resp.json()["detail"]
        assert CHAVE not in resp.text

    def test_limite_de_testes_por_minuto(self, client, admin):
        _salvar(client, admin)

        with patch.object(ai_providers, "complete", return_value=AIResult("ok", 0, 0)):
            codigos = [client.post("/settings/ai/openrouter/test", headers=admin).status_code for _ in range(6)]

        assert codigos == [200, 200, 200, 200, 200, 429]

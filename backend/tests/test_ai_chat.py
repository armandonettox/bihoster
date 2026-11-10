"""POST /ai/chat: permissao, validacao do corpo, provedor nao configurado, resposta completa,
erros e auditoria sem o texto da conversa."""

import json
from unittest.mock import patch

import pytest

from app.core import ai_providers, ai_report_settings, chat_dataset, chat_engine, chat_images
from app.core.ai_providers import AIError, AIResult
from app.core.chat_dataset import ChatQueryResult, DatasetSchema, SchemaColumn, SchemaTable
from app.core.powerbi import PowerBIError
from app.core.workspace_deps import ensure_default_group_access
from app.models.audit_log import AuditLog
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.workspace import Workspace

PASSWORD = "SenhaForte123"
ESQUEMA = DatasetSchema(tables=(SchemaTable("Vendas", (SchemaColumn("Valor", "decimal"),), (("Total", None),)),))
RESULTADO = ChatQueryResult(columns=["[Total]"], rows=[{"[Total]": 99}], total_rows=1, truncated=False)


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


@pytest.fixture
def relatorio(db_session):
    colecao = Workspace(name="Comercial", slug="comercial")
    conexao = PowerBIConnection(name="Conta", tenant_id="t", client_id="c", client_secret="s")
    db_session.add_all([colecao, conexao])
    db_session.commit()
    rel = Report(
        collection_id=colecao.id,
        name="Vendas do mes",
        powerbi_connection_id=conexao.id,
        pbi_workspace_id="ws",
        pbi_report_id="rep",
        pbi_dataset_id="ds",
    )
    db_session.add(rel)
    db_session.commit()
    return rel


@pytest.fixture
def provedor(client, admin):
    """Provedor ativo e escolhido para o chat."""
    client.put("/settings/ai/openrouter", json={"api_key": "chave-x", "model": "modelo-x", "enabled": True, "chat_default": True}, headers=admin)


@pytest.fixture
def ia(monkeypatch):
    """IA e Power BI simulados: a IA responde o JSON do DAX e depois o texto final."""
    estado = {
        "respostas": [json.dumps({"dax": "EVALUATE ROW(\"t\", [Total])"}), "O total foi 99."],
        "chamadas": 0,
        "mensagens": [],  # as mensagens de cada chamada a IA, na ordem
    }

    def fake_complete(provider, api_key, model, messages, max_tokens=1024):
        estado["chamadas"] += 1
        estado["mensagens"].append(messages)
        resposta = estado["respostas"].pop(0)
        if isinstance(resposta, Exception):
            raise resposta
        return AIResult(resposta, 12, 4)

    monkeypatch.setattr(ai_providers, "complete", fake_complete)
    monkeypatch.setattr(chat_dataset, "get_dataset_schema", lambda connection, report: ESQUEMA)
    monkeypatch.setattr(chat_dataset, "run_chat_query", lambda connection, report, dax, blocked=(): RESULTADO)
    return estado


@pytest.fixture(autouse=True)
def _imagens_limpas():
    chat_images.clear()
    yield
    chat_images.clear()


def _chat(client, headers, texto="Qual o total de vendas?", **extra):
    return client.post("/ai/chat", json={"message": texto, **extra}, headers=headers)


def _liberar_usar(client, admin, email="pessoa@example.com"):
    grupo = client.post("/groups/", json={"name": "Analistas"}, headers=admin).json()["id"]
    client.post(f"/groups/{grupo}/members", json={"email": email}, headers=admin)
    client.put(f"/groups/{grupo}/permissions", json={"permissions": ["ia.usar"]}, headers=admin)


class TestPermissao:
    def test_exige_estar_logado(self, client):
        assert client.post("/ai/chat", json={"message": "oi"}).status_code == 401

    def test_quem_nao_pode_usar_o_chat_recebe_403(self, client, pessoa, relatorio, provedor, ia):
        resp = _chat(client, pessoa)

        assert resp.status_code == 403
        assert ia["chamadas"] == 0

    def test_quem_so_gerencia_a_ia_nao_usa_o_chat(self, client, admin, pessoa, relatorio, provedor, ia):
        grupo = client.post("/groups/", json={"name": "Gestores"}, headers=admin).json()["id"]
        client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=admin)
        client.put(f"/groups/{grupo}/permissions", json={"permissions": ["ia.gerenciar"]}, headers=admin)

        assert _chat(client, pessoa).status_code == 403

    def test_quem_tem_ia_usar_e_acesso_a_colecao_conversa(self, client, admin, pessoa, relatorio, provedor, ia, db_session):
        ensure_default_group_access(db_session, relatorio.collection_id)
        _liberar_usar(client, admin)

        resp = _chat(client, pessoa)

        assert resp.status_code == 200 and resp.json()["report"]["id"] == relatorio.id

    def test_quem_pode_usar_mas_nao_ve_nenhuma_colecao_nao_acha_relatorio(self, client, admin, pessoa, relatorio, provedor, ia):
        _liberar_usar(client, admin)  # sem acesso dado a colecao

        corpo = _chat(client, pessoa).json()

        assert corpo["reply"] == chat_engine.REPLY_NO_REPORTS and corpo["report"] is None
        assert ia["chamadas"] == 0


class TestValidacao:
    @pytest.mark.parametrize(
        "corpo",
        [
            {},
            {"message": ""},
            {"message": "   "},
            {"message": "x" * 4001},
            {"message": "oi", "conversation_id": "abc"},
            # forma antiga da API (a conversa inteira vinha do cliente): o servidor guarda o historico agora
            {"messages": [{"role": "user", "content": "oi"}]},
        ],
    )
    def test_corpo_invalido_e_recusado_sem_chamar_a_ia(self, client, admin, relatorio, provedor, ia, corpo):
        assert client.post("/ai/chat", json=corpo, headers=admin).status_code == 422
        assert ia["chamadas"] == 0

    def test_mensagem_no_limite_de_tamanho_e_aceita(self, client, admin, relatorio, provedor, ia):
        assert _chat(client, admin, "x" * 4000).status_code == 200


class TestProvedorNaoConfigurado:
    def test_sem_provedor_responde_503_com_orientacao(self, client, admin, relatorio, ia):
        resp = _chat(client, admin)

        assert resp.status_code == 503
        assert "administrador" in resp.json()["detail"]
        assert ia["chamadas"] == 0

    def test_provedor_ativo_mas_nao_escolhido_com_dois_prontos(self, client, admin, relatorio, ia):
        for nome in ("openai", "gemini"):
            client.put(f"/settings/ai/{nome}", json={"api_key": "k", "model": "m", "enabled": True}, headers=admin)

        assert _chat(client, admin).status_code == 503


class TestResposta:
    def test_resposta_completa(self, client, admin, relatorio, provedor, ia):
        resp = _chat(client, admin)

        assert resp.status_code == 200
        corpo = resp.json()
        assert corpo["conversation_id"] > 0 and corpo["conversation_title"] == "Qual o total de vendas?"
        assert corpo["reply"] == "O total foi 99."
        assert corpo["report"] == {"id": relatorio.id, "name": "Vendas do mes"}
        assert corpo["dax"] == 'EVALUATE ROW("t", [Total])'
        assert corpo["table"] == {"columns": ["[Total]"], "rows": [{"[Total]": 99}], "total_rows": 1, "truncated": False}
        assert corpo["usage"] == {
            "provider": "openrouter",
            "model": "modelo-x",
            "llm_calls": 2,
            "input_tokens": 24,
            "output_tokens": 8,
            "cost_usd": None,  # sem preco do OpenRouter nos testes: a rede esta bloqueada
        }

    def test_resposta_sem_dados_vem_sem_dax_e_sem_tabela(self, client, admin, relatorio, provedor, ia):
        ia["respostas"] = [json.dumps({"reply": "So respondo sobre os dados do relatorio."})]

        corpo = _chat(client, admin, "Escreva um poema").json()

        assert corpo["reply"] == "So respondo sobre os dados do relatorio."
        assert corpo["dax"] is None and corpo["table"] is None

    def test_a_chave_do_provedor_nunca_aparece_na_resposta(self, client, admin, relatorio, provedor, ia):
        assert "chave-x" not in _chat(client, admin).text

class TestErros:
    def test_falha_do_provedor_de_ia_vira_502_com_mensagem_clara(self, client, admin, relatorio, provedor, ia):
        ia["respostas"] = [AIError("O provedor recusou a chave de API. Confira se ela esta correta e ativa.")]

        resp = _chat(client, admin)

        assert resp.status_code == 502
        assert "recusou a chave" in resp.json()["detail"]
        assert "chave-x" not in resp.text

    def test_resposta_da_ia_fora_do_formato_vira_502(self, client, admin, relatorio, provedor, ia):
        ia["respostas"] = ["nao sei", "continuo sem saber"]

        resp = _chat(client, admin)

        assert resp.status_code == 502 and "formato esperado" in resp.json()["detail"]

    def test_falha_do_power_bi_vira_502_pelo_tratador_global(self, client, admin, relatorio, provedor, ia, monkeypatch):
        def quebra(connection, report):
            raise PowerBIError("Falha ao executar query DAX: HTTP 401")

        monkeypatch.setattr(chat_dataset, "get_dataset_schema", quebra)

        resp = _chat(client, admin)

        assert resp.status_code == 502 and "HTTP 401" in resp.json()["detail"]

    def test_relatorio_com_rls_volta_200_com_o_motivo(self, client, admin, relatorio, provedor, ia, monkeypatch):
        def bloqueado(connection, report):
            raise chat_dataset.ChatDataError(chat_dataset.REASON_RLS)

        monkeypatch.setattr(chat_dataset, "get_dataset_schema", bloqueado)

        resp = _chat(client, admin)

        assert resp.status_code == 200
        assert "seguranca por linha" in resp.json()["reply"] and resp.json()["table"] is None
        assert ia["chamadas"] == 0

    def test_limite_de_trinta_por_minuto(self, client, admin, relatorio, provedor):
        from app.core.chat_engine import ChatAnswer

        with patch.object(chat_engine, "answer_question", return_value=ChatAnswer(reply="ok", provider="p", model="m")):
            codigos = [_chat(client, admin).status_code for _ in range(31)]

        assert codigos == [200] * 30 + [429]


class TestAuditoria:
    def test_registra_so_o_resumo_e_nunca_o_texto_da_conversa(self, client, admin, relatorio, provedor, ia, db_session):
        _chat(client, admin, "Qual o salario do fulano de tal CPF 123?")

        log = db_session.query(AuditLog).filter(AuditLog.action == "ai_chat").one()
        assert log.entity == "report" and log.entity_id == str(relatorio.id)
        assert log.user_email == "admin@example.com"
        assert "openrouter modelo-x; 2 chamadas; 24 tokens de entrada e 8 de saida" == log.details
        for texto in ("salario", "fulano", "CPF", "O total foi 99", "EVALUATE"):
            assert texto not in log.details

    def test_resposta_sem_relatorio_registra_sem_id(self, client, admin, relatorio, provedor, ia, db_session):
        ia["respostas"] = [json.dumps({"reply": "fora do escopo"})]
        db_session.query(Report).delete()
        db_session.commit()

        _chat(client, admin)

        assert db_session.query(AuditLog).filter(AuditLog.action == "ai_chat").one().entity_id is None


class TestPaginaAberta:
    def _pagina(self, **extra):
        return {
            "report_id": 1,
            "page_name": "ReportSection1",
            "page_title": "Custo por unidade",
            "visuals": [{"title": "Vidas por unidade", "type": "barChart", "fields": ["dim_unidade[uf]", "[Vidas Ativas]"]}],
            **extra,
        }

    def test_a_pagina_aberta_chega_ao_prompt_do_dax(self, client, admin, relatorio, provedor, ia):
        resp = _chat(client, admin, open_page=self._pagina(report_id=relatorio.id))

        assert resp.status_code == 200
        prompt = ia["mensagens"][0][0]["content"]
        assert 'pagina "Custo por unidade"' in prompt and "Vidas por unidade (barChart): dim_unidade[uf]; [Vidas Ativas]" in prompt

    def test_pagina_de_outro_relatorio_e_ignorada(self, client, admin, relatorio, provedor, ia):
        _chat(client, admin, open_page=self._pagina(report_id=relatorio.id + 100))

        assert "Vidas por unidade" not in ia["mensagens"][0][0]["content"]

    def test_o_que_passa_do_limite_e_cortado_e_nao_recusado(self, client, admin, relatorio, provedor, ia):
        muitos = [{"title": f"grafico {i}", "type": "t", "fields": ["a"] * 50} for i in range(60)]
        pagina = self._pagina(report_id=relatorio.id, visuals=muitos, page_title="x" * 500)

        resp = _chat(client, admin, open_page=pagina)

        assert resp.status_code == 200
        prompt = ia["mensagens"][0][0]["content"]
        assert "grafico 39" in prompt and "grafico 40" not in prompt
        assert "x" * 200 not in prompt  # o titulo da pagina foi cortado

    def test_nome_de_pagina_fora_do_formato_nao_pede_nem_usa_imagem(self, client, admin, relatorio, provedor, ia, db_session):
        ai_report_settings.save_settings(db_session, relatorio.id, "", [], True)
        chat_images._store((relatorio.id, "../etc"), b"png")

        resp = _chat(client, admin, open_page=self._pagina(report_id=relatorio.id, page_name="../etc"))

        assert resp.status_code == 200 and resp.json()["used_image"] is False

    def test_sem_pagina_aberta_nada_muda(self, client, admin, relatorio, provedor, ia):
        corpo = _chat(client, admin).json()

        assert corpo["used_image"] is False
        assert "Graficos da pagina aberta" not in ia["mensagens"][0][0]["content"]


class TestImagemDaPagina:
    def _preparar(self, db_session, relatorio, liberar=True):
        ai_report_settings.save_settings(db_session, relatorio.id, "", [], liberar)
        chat_images._store((relatorio.id, "ReportSection1"), b"PNGDATA")

    def _pagina(self, relatorio):
        return {"report_id": relatorio.id, "page_name": "ReportSection1", "visuals": []}

    def test_com_imagem_liberada_e_pronta_ela_vai_na_pergunta_e_a_resposta_avisa(
        self, client, admin, relatorio, provedor, ia, db_session
    ):
        self._preparar(db_session, relatorio)

        corpo = _chat(client, admin, open_page=self._pagina(relatorio)).json()

        assert corpo["used_image"] is True
        ultima = ia["mensagens"][0][-1]["content"]
        assert isinstance(ultima, list) and [p["type"] for p in ultima] == ["text", "image"]
        assert "traz a imagem da pagina" in ia["mensagens"][0][0]["content"]

    def test_sem_a_liberacao_do_admin_a_imagem_nao_vai_mesmo_pronta(self, client, admin, relatorio, provedor, ia, db_session):
        self._preparar(db_session, relatorio, liberar=False)

        corpo = _chat(client, admin, open_page=self._pagina(relatorio)).json()

        assert corpo["used_image"] is False
        assert isinstance(ia["mensagens"][0][-1]["content"], str)

    def test_imagem_ainda_nao_pronta_nao_espera_e_segue_so_com_texto(self, client, admin, relatorio, provedor, ia, db_session):
        ai_report_settings.save_settings(db_session, relatorio.id, "", [], True)

        corpo = _chat(client, admin, open_page=self._pagina(relatorio)).json()

        assert corpo["used_image"] is False and corpo["reply"] == "O total foi 99."

    def test_provedor_que_recusa_a_imagem_refaz_so_com_texto(self, client, admin, relatorio, provedor, ia, db_session):
        self._preparar(db_session, relatorio)
        ia["respostas"] = [AIError("modelo sem visao"), json.dumps({"dax": 'EVALUATE ROW("t", [Total])'}), "O total foi 99."]

        corpo = _chat(client, admin, open_page=self._pagina(relatorio)).json()

        assert corpo["reply"] == "O total foi 99." and corpo["used_image"] is False
        assert isinstance(ia["mensagens"][0][-1]["content"], list)  # a primeira tentativa levou a imagem
        assert all(isinstance(m[-1]["content"], str) for m in ia["mensagens"][1:])  # as outras, so texto

"""Registro do chat de IA para o admin: grava toda pergunta (respondida ou nao), so quem gerencia a IA le,
filtros e paginas, resumo por modelo, prazo de 30 dias e o cuidado de nunca derrubar a pergunta."""

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.core import ai_history_runner, ai_providers, chat_dataset, chat_engine, chat_log
from app.core.ai_providers import AIError, AIResult
from app.core.chat_dataset import ChatQueryResult, DatasetSchema, SchemaColumn, SchemaTable
from app.core.powerbi import PowerBIError
from app.core.workspace_deps import ensure_default_group_access
from app.models.ai_chat_log import AIChatLog
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
    client.put(
        "/settings/ai/openrouter",
        json={"api_key": "chave-x", "model": "deepseek/deepseek-v4-pro", "enabled": True, "chat_default": True},
        headers=admin,
    )


@pytest.fixture
def ia(monkeypatch):
    estado = {"respostas": [json.dumps({"dax": 'EVALUATE ROW("t", [Total])'}), "O total foi 99."]}

    def fake_complete(provider, api_key, model, messages, max_tokens=1024, json_mode=False):
        resposta = estado["respostas"].pop(0)
        if isinstance(resposta, Exception):
            raise resposta
        if isinstance(resposta, AIResult):
            return resposta
        return AIResult(resposta, 12, 4, finish_reason="stop")

    monkeypatch.setattr(ai_providers, "complete", fake_complete)
    monkeypatch.setattr(chat_dataset, "get_dataset_schema", lambda connection, report: ESQUEMA)
    monkeypatch.setattr(chat_dataset, "run_chat_query", lambda connection, report, dax, blocked=(): RESULTADO)
    return estado


def _chat(client, headers, texto="Qual o total de vendas?", **extra):
    return client.post("/ai/chat", json={"message": texto, **extra}, headers=headers)


def _linha(db, **campos) -> AIChatLog:
    base = dict(
        created_at=datetime.now(timezone.utc),
        user_id=1,
        user_email="ana@example.com",
        provider="openrouter",
        model="m1",
        outcome="answered",
        duration_ms=1000,
        llm_calls=2,
        input_tokens=10,
        output_tokens=5,
        question="pergunta",
        reply="resposta",
    )
    base.update(campos)
    linha = AIChatLog(**base)
    db.add(linha)
    db.commit()
    return linha


def _log(client, headers, **params):
    return client.get("/ai/log/", params=params, headers=headers)


class TestGravacaoNoChat:
    def test_pergunta_respondida_fica_registrada_com_provedor_modelo_tempo_e_passos(
        self, client, admin, relatorio, provedor, ia, db_session
    ):
        assert _chat(client, admin, "Qual o total de vendas?").status_code == 200

        linha = db_session.query(AIChatLog).one()
        assert (linha.provider, linha.model, linha.outcome) == ("openrouter", "deepseek/deepseek-v4-pro", "answered")
        assert linha.user_email == "admin@example.com" and linha.report_name == "Vendas do mes"
        assert linha.question == "Qual o total de vendas?" and linha.reply == "O total foi 99."
        assert linha.dax == 'EVALUATE ROW("t", [Total])' and linha.error is None
        assert linha.duration_ms >= 0 and linha.llm_calls == 2 and linha.input_tokens == 24 and linha.output_tokens == 8
        passos = chat_log.parse_steps(linha.steps_json)
        assert [p["step"] for p in passos] == ["ler_esquema", "gerar_consulta", "power_bi", "escrever_resposta"]
        assert passos[1]["finish_reason"] == "stop" and passos[1]["json_ok"] is True
        assert linha.conversation_id is not None

    def test_nunca_guarda_as_linhas_da_tabela(self, client, admin, relatorio, provedor, ia, db_session):
        _chat(client, admin)

        linha = db_session.query(AIChatLog).one()
        todo_o_texto = " ".join(str(v) for v in vars(linha).values())
        # Dos dados que voltaram do Power BI so a quantidade de linhas entra nos passos; nome de coluna e valor, nunca
        assert '"rows": 1' in linha.steps_json and "[Total]" not in linha.steps_json
        assert '"[Total]": 99' not in todo_o_texto
        assert not {"rows", "table", "linhas"} & set(AIChatLog.__table__.columns.keys())

    def test_falha_da_ia_fica_registrada_como_erro_com_o_passo_que_falhou(
        self, client, admin, relatorio, provedor, ia, db_session
    ):
        ia["respostas"] = [AIError("O provedor demorou demais para responder.")]

        resp = _chat(client, admin, "Quanto vendemos?")

        assert resp.status_code == 502
        linha = db_session.query(AIChatLog).one()
        assert linha.outcome == "error" and linha.error == "O provedor demorou demais para responder."
        assert linha.question == "Quanto vendemos?" and linha.reply is None
        assert linha.model == "deepseek/deepseek-v4-pro"
        passos = chat_log.parse_steps(linha.steps_json)
        assert passos[-1]["step"] == "gerar_consulta" and "demorou demais" in passos[-1]["error"]

    def test_resposta_vazia_da_ia_fica_registrada_com_o_motivo_da_parada(
        self, client, admin, relatorio, provedor, ia, db_session
    ):
        vazia = AIResult("", 100, 2500, finish_reason="length", reasoning_tokens=2500)
        ia["respostas"] = [vazia, vazia]

        resp = _chat(client, admin)

        assert resp.status_code == 502 and "vazia" in resp.json()["detail"]
        linha = db_session.query(AIChatLog).one()
        passos = chat_log.parse_steps(linha.steps_json)
        assert linha.outcome == "error" and linha.llm_calls == 2 and linha.output_tokens == 5000
        assert [p["finish_reason"] for p in passos if "finish_reason" in p] == ["length", "length"]
        assert passos[-1]["reasoning_tokens"] == 2500

    def test_falha_do_power_bi_tambem_fica_registrada(self, client, admin, relatorio, provedor, ia, db_session, monkeypatch):
        def quebra(connection, report):
            raise PowerBIError("Falha ao executar query DAX: HTTP 401")

        monkeypatch.setattr(chat_dataset, "get_dataset_schema", quebra)

        resp = _chat(client, admin)

        assert resp.status_code == 502
        linha = db_session.query(AIChatLog).one()
        assert linha.outcome == "error" and "HTTP 401" in linha.error

    def test_recusa_padrao_fica_registrada_para_o_admin_rever(self, client, admin, relatorio, provedor, ia, db_session):
        ia["respostas"] = [json.dumps({})]

        corpo = _chat(client, admin, "Conte uma piada").json()

        assert corpo["reply"] == chat_engine.REPLY_OFF_TOPIC
        assert db_session.query(AIChatLog).one().outcome == "off_topic"

    def test_pergunta_e_resposta_longas_sao_cortadas(self, client, admin, relatorio, provedor, ia, db_session):
        ia["respostas"] = [json.dumps({"dax": "EVALUATE x"}), "r" * 5000]

        _chat(client, admin, "p" * 3000)

        linha = db_session.query(AIChatLog).one()
        assert len(linha.question) == chat_log.MAX_QUESTION_CHARS and linha.question.endswith("...")
        assert len(linha.reply) == chat_log.MAX_REPLY_CHARS

    def test_se_gravar_o_registro_falha_a_pergunta_segue(self, client, admin, relatorio, provedor, ia, db_session):
        with patch.object(chat_log, "AIChatLog", side_effect=RuntimeError("disco cheio")):
            resp = _chat(client, admin)

        assert resp.status_code == 200 and resp.json()["reply"] == "O total foi 99."
        assert db_session.query(AIChatLog).count() == 0

    def test_limite_de_perguntas_e_provedor_ausente_nao_gravam(self, client, admin, relatorio, ia, db_session):
        # Sem provedor escolhido: 503 antes de qualquer chamada, nada a registrar
        assert _chat(client, admin).status_code == 503
        assert db_session.query(AIChatLog).count() == 0


class TestRegistrar:
    USER = SimpleNamespace(id=7, email="ana@example.com")

    def test_registro_de_erro_soma_so_as_chamadas_que_terminaram(self, db_session):
        trace = [
            {"step": "ler_esquema", "ms": 5},
            {"step": "gerar_consulta", "ms": 900, "text_chars": 40, "input_tokens": 10, "output_tokens": 4},
            {"step": "gerar_consulta (nova tentativa)", "ms": 100, "error": "fora do ar"},
        ]

        chat_log.record(
            db_session, user=self.USER, conversation_id=None, provider="p", model="m", question="q",
            duration_ms=1005, trace=trace, error="fora do ar",
        )

        linha = db_session.query(AIChatLog).one()
        assert (linha.llm_calls, linha.input_tokens, linha.output_tokens) == (1, 10, 4)
        assert linha.duration_ms == 1005 and linha.outcome == "error"

    def test_sem_passos_nao_grava_json_vazio(self, db_session):
        chat_log.record(db_session, user=self.USER, conversation_id=None, provider="p", model="m", question="q", duration_ms=1, trace=[], error="x")

        assert db_session.query(AIChatLog).one().steps_json is None
        assert chat_log.parse_steps(None) == [] and chat_log.parse_steps("nao e json") == [] and chat_log.parse_steps('"texto"') == []

    def test_tempo_negativo_vira_zero(self, db_session):
        chat_log.record(db_session, user=self.USER, conversation_id=None, provider="p", model="m", question="q", duration_ms=-5, trace=[], error="x")

        assert db_session.query(AIChatLog).one().duration_ms == 0


class TestPermissao:
    def test_exige_estar_logado(self, client):
        assert client.get("/ai/log/").status_code == 401

    def test_quem_so_usa_o_chat_nao_ve_o_registro(self, client, admin, pessoa, relatorio, db_session):
        ensure_default_group_access(db_session, relatorio.collection_id)
        grupo = client.post("/groups/", json={"name": "Usuarios"}, headers=admin).json()["id"]
        client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=admin)
        client.put(f"/groups/{grupo}/permissions", json={"permissions": ["ia.usar"]}, headers=admin)
        _linha(db_session)

        assert _log(client, pessoa).status_code == 403

    def test_quem_gerencia_a_ia_ve(self, client, admin, pessoa, db_session):
        grupo = client.post("/groups/", json={"name": "Dados"}, headers=admin).json()["id"]
        client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=admin)
        client.put(f"/groups/{grupo}/permissions", json={"permissions": ["ia.gerenciar"]}, headers=admin)
        _linha(db_session)

        resp = _log(client, pessoa)

        assert resp.status_code == 200 and len(resp.json()["entries"]) == 1

    def test_consultar_o_registro_entra_na_auditoria_so_na_primeira_pagina(self, client, admin, db_session):
        for _ in range(3):
            _linha(db_session)

        primeira = _log(client, admin, limit=2).json()
        _log(client, admin, limit=2, before_id=primeira["next_before_id"])

        linhas = db_session.query(AuditLog).filter_by(action="view_ai_log").all()
        assert len(linhas) == 1 and linhas[0].details == "dias=7; so_problemas=nao"


class TestConsulta:
    def test_do_mais_novo_para_o_mais_antigo_com_todos_os_campos(self, client, admin, db_session):
        _linha(db_session, question="primeira", steps_json=json.dumps([{"step": "gerar_consulta", "ms": 12}]))
        _linha(db_session, question="segunda", outcome="off_topic", used_image=True, dax="EVALUATE x", report_name="Carteira")

        corpo = _log(client, admin).json()

        assert [e["question"] for e in corpo["entries"]] == ["segunda", "primeira"]
        segunda, primeira = corpo["entries"]
        assert segunda["outcome"] == "off_topic" and segunda["used_image"] is True and segunda["report_name"] == "Carteira"
        assert segunda["dax"] == "EVALUATE x" and segunda["steps"] == []
        assert primeira["steps"] == [{"step": "gerar_consulta", "ms": 12}] and primeira["user_email"] == "ana@example.com"
        assert corpo["retention_days"] == 30 and corpo["days"] == 7 and corpo["next_before_id"] is None

    def test_so_problemas_esconde_o_que_foi_respondido_e_o_bloqueio_esperado(self, client, admin, db_session):
        for outcome in ("answered", "blocked", "no_reports", "off_topic", "error", "needs_detail", "model_reply", "no_dax", "no_report", "empty_answer"):
            _linha(db_session, outcome=outcome)

        todos = _log(client, admin).json()["entries"]
        problemas = _log(client, admin, only_problems=True).json()["entries"]

        assert len(todos) == 10
        assert {e["outcome"] for e in problemas} == set(chat_log.PROBLEM_OUTCOMES)

    def test_filtra_por_provedor_e_modelo(self, client, admin, db_session):
        _linha(db_session, provider="openrouter", model="a", question="1")
        _linha(db_session, provider="openrouter", model="b", question="2")
        _linha(db_session, provider="openai", model="a", question="3")

        assert [e["question"] for e in _log(client, admin, model="a").json()["entries"]] == ["3", "1"]
        assert [e["question"] for e in _log(client, admin, provider="openai").json()["entries"]] == ["3"]
        assert [e["question"] for e in _log(client, admin, provider="openrouter", model="b").json()["entries"]] == ["2"]

    def test_periodo_deixa_de_fora_o_que_e_mais_antigo(self, client, admin, db_session):
        _linha(db_session, question="velha", created_at=datetime.now(timezone.utc) - timedelta(days=10))
        _linha(db_session, question="nova")

        assert [e["question"] for e in _log(client, admin, days=7).json()["entries"]] == ["nova"]
        assert len(_log(client, admin, days=30).json()["entries"]) == 2

    def test_paginas_com_before_id_cobrem_tudo_sem_repetir(self, client, admin, db_session):
        for i in range(5):
            _linha(db_session, question=f"p{i}")

        pagina1 = _log(client, admin, limit=2).json()
        pagina2 = _log(client, admin, limit=2, before_id=pagina1["next_before_id"]).json()
        pagina3 = _log(client, admin, limit=2, before_id=pagina2["next_before_id"]).json()

        perguntas = [e["question"] for p in (pagina1, pagina2, pagina3) for e in p["entries"]]
        assert perguntas == ["p4", "p3", "p2", "p1", "p0"]
        assert pagina3["next_before_id"] is None and pagina1["next_before_id"] is not None

    @pytest.mark.parametrize("params", [{"days": 0}, {"days": 31}, {"limit": 0}, {"limit": 101}, {"before_id": 0}])
    def test_valores_fora_do_limite_sao_recusados(self, client, admin, params):
        assert _log(client, admin, **params).status_code == 422


class TestResumoPorModelo:
    def test_conta_problemas_e_calcula_tempo_medio_e_p95_por_modelo(self, client, admin, db_session):
        for ms in (100, 200, 300, 400, 1000):
            _linha(db_session, model="rapido", duration_ms=ms)
        _linha(db_session, model="rapido", outcome="off_topic", duration_ms=500)
        _linha(db_session, model="lento", duration_ms=30000, outcome="error")

        por_modelo = {m["model"]: m for m in _log(client, admin).json()["by_model"]}

        rapido = por_modelo["rapido"]
        assert (rapido["questions"], rapido["problems"], rapido["avg_ms"], rapido["p95_ms"]) == (6, 1, 416, 1000)
        assert por_modelo["lento"]["problems"] == 1 and por_modelo["lento"]["avg_ms"] == 30000

    def test_modelos_vem_do_que_tem_mais_perguntas_para_o_que_tem_menos(self, client, admin, db_session):
        _linha(db_session, model="pouco")
        for _ in range(3):
            _linha(db_session, model="muito")

        assert [m["model"] for m in _log(client, admin).json()["by_model"]] == ["muito", "pouco"]

    def test_o_resumo_ignora_o_filtro_de_problemas_e_conta_o_periodo_todo(self, client, admin, db_session):
        _linha(db_session, model="m")
        _linha(db_session, model="m", outcome="error")

        corpo = _log(client, admin, only_problems=True).json()

        assert len(corpo["entries"]) == 1 and corpo["by_model"][0]["questions"] == 2

    def test_sem_registros_o_resumo_e_vazio(self, client, admin):
        assert _log(client, admin).json()["by_model"] == []


class TestPrazo:
    def test_apaga_so_o_que_passou_de_30_dias(self, db_session):
        _linha(db_session, question="velha", created_at=datetime.now(timezone.utc) - timedelta(days=31))
        _linha(db_session, question="limite", created_at=datetime.now(timezone.utc) - timedelta(days=29))
        _linha(db_session, question="nova")

        removidas = chat_log.purge_expired(db_session)

        assert removidas == 1
        assert {l.question for l in db_session.query(AIChatLog).all()} == {"limite", "nova"}

    def test_a_limpeza_horaria_tambem_apaga_o_registro_vencido(self, db_session):
        _linha(db_session, created_at=datetime.now(timezone.utc) - timedelta(days=45))

        with patch.object(ai_history_runner, "SessionLocal", return_value=db_session), patch.object(db_session, "close"):
            ai_history_runner.run_once()

        assert db_session.query(AIChatLog).count() == 0

    def test_apagar_a_conversa_ou_o_usuario_nao_apaga_o_registro_do_admin(self, client, admin, relatorio, provedor, ia, db_session):
        corpo = _chat(client, admin).json()

        client.delete(f"/ai/conversations/{corpo['conversation_id']}", headers=admin)

        assert db_session.query(AIChatLog).count() == 1

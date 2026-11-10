"""Historico do chat de IA: cada pessoa ve e apaga so as proprias conversas, as linhas de tabela nao
sao guardadas, o prazo de retencao apaga o que venceu e excluir o usuario leva o historico junto."""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from app.core import ai_history_runner, ai_providers, chat_dataset, chat_engine, chat_history
from app.core.ai_providers import AIError, AIResult
from app.core.chat_dataset import ChatQueryResult, DatasetSchema, SchemaColumn, SchemaTable
from app.core.workspace_deps import ensure_default_group_access
from app.models.ai_conversation import AIConversation, AIMessage
from app.models.audit_log import AuditLog
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.user import User
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
def ana(client, admin, db_session):
    return _headers(client, "ana@example.com")


@pytest.fixture
def beto(client, admin, db_session):
    return _headers(client, "beto@example.com")


@pytest.fixture
def relatorio(db_session):
    colecao = Workspace(name="Comercial", slug="comercial")
    conexao = PowerBIConnection(name="Conta", tenant_id="t", client_id="c", client_secret="s")
    db_session.add_all([colecao, conexao])
    db_session.commit()
    ensure_default_group_access(db_session, colecao.id)
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
def ia(client, admin, monkeypatch):
    """Provedor escolhido, IA e Power BI simulados. `chamadas` guarda o que a IA recebeu."""
    client.put(
        "/settings/ai/openrouter",
        json={"api_key": "chave-x", "model": "modelo-x", "enabled": True, "chat_default": True},
        headers=admin,
    )
    estado = {"chamadas": [], "dax_first": True}

    def fake_complete(provider, api_key, model, messages, max_tokens=1024):
        estado["chamadas"].append(messages)
        if isinstance(estado.get("erro"), Exception):
            raise estado["erro"]
        # Passo do DAX devolve o JSON; o passo final devolve o texto
        if "Modelo de dados" in messages[0]["content"]:
            return AIResult(json.dumps({"dax": 'EVALUATE ROW("t", [Total])'}), 5, 2)
        return AIResult("O total foi 99.", 5, 2)

    monkeypatch.setattr(ai_providers, "complete", fake_complete)
    monkeypatch.setattr(chat_dataset, "get_dataset_schema", lambda connection, report: ESQUEMA)
    monkeypatch.setattr(chat_dataset, "run_chat_query", lambda connection, report, dax: RESULTADO)
    return estado


def _liberar_usar(client, admin, email):
    grupo = client.post("/groups/", json={"name": f"Analistas {email}"}, headers=admin).json()["id"]
    client.post(f"/groups/{grupo}/members", json={"email": email}, headers=admin)
    client.put(f"/groups/{grupo}/permissions", json={"permissions": ["ia.usar"]}, headers=admin)


@pytest.fixture
def liberados(client, admin, ana, beto):
    _liberar_usar(client, admin, "ana@example.com")
    _liberar_usar(client, admin, "beto@example.com")


def _chat(client, headers, texto="Qual o total de vendas?", **extra):
    return client.post("/ai/chat", json={"message": texto, **extra}, headers=headers)


def _antiga(db, conversa_id: int, dias: float):
    conversa = db.query(AIConversation).get(conversa_id)
    conversa.updated_at = datetime.now(timezone.utc) - timedelta(days=dias)
    db.commit()


class TestGuardarConversa:
    def test_a_primeira_pergunta_cria_a_conversa_com_titulo_e_guarda_as_duas_mensagens(
        self, client, ana, liberados, relatorio, ia, db_session
    ):
        corpo = _chat(client, ana, "Qual o total de vendas?").json()

        conversa = db_session.query(AIConversation).one()
        assert conversa.id == corpo["conversation_id"] and conversa.title == "Qual o total de vendas?"
        mensagens = db_session.query(AIMessage).order_by(AIMessage.id).all()
        assert [(m.role, m.content) for m in mensagens] == [
            ("user", "Qual o total de vendas?"),
            ("assistant", "O total foi 99."),
        ]
        resposta = mensagens[1]
        assert (resposta.report_id, resposta.report_name) == (relatorio.id, "Vendas do mes")
        assert resposta.dax == 'EVALUATE ROW("t", [Total])'
        assert mensagens[0].report_id is None and mensagens[0].dax is None

    def test_as_linhas_da_tabela_nunca_ficam_guardadas(self, client, ana, liberados, relatorio, ia, db_session):
        resposta = _chat(client, ana).json()
        assert resposta["table"]["rows"] == [{"[Total]": 99}]  # volta so nesta resposta

        guardado = " ".join(
            str(valor)
            for m in db_session.query(AIMessage).all()
            for valor in (m.content, m.dax, m.report_name)
            if valor
        )
        assert "[Total]\": 99" not in guardado and "'[Total]': 99" not in guardado
        assert not hasattr(AIMessage, "rows") and not hasattr(AIMessage, "table")

    def test_titulo_longo_e_cortado_e_em_uma_linha(self):
        titulo = chat_history.make_title("Qual foi\no total de vendas " + "muito longo " * 20)

        assert len(titulo) <= chat_history.TITLE_MAX_CHARS and titulo.endswith("...") and "\n" not in titulo

    def test_continuar_a_conversa_manda_o_historico_a_ia_e_nao_cria_outra(
        self, client, ana, liberados, relatorio, ia, db_session
    ):
        primeira = _chat(client, ana, "Qual o total?").json()
        ia["chamadas"].clear()

        segunda = _chat(client, ana, "E por mes?", conversation_id=primeira["conversation_id"]).json()

        assert segunda["conversation_id"] == primeira["conversation_id"]
        assert db_session.query(AIConversation).count() == 1 and db_session.query(AIMessage).count() == 4
        conversa_enviada = [(m["role"], m["content"]) for m in ia["chamadas"][0][1:]]
        assert conversa_enviada == [
            ("user", "Qual o total?"),
            ("assistant", "O total foi 99."),
            ("user", "E por mes?"),
        ]

    def test_a_conversa_lembra_o_relatorio_da_ultima_resposta(self, client, ana, liberados, relatorio, ia, db_session):
        _chat(client, ana)

        assert db_session.query(AIConversation).one().last_report_id == relatorio.id

    def test_o_relatorio_da_conversa_vai_como_dica_ao_motor(self, client, ana, liberados, relatorio, ia):
        primeira = _chat(client, ana).json()

        with patch.object(chat_engine, "answer_question", wraps=chat_engine.answer_question) as motor:
            _chat(client, ana, "E por mes?", conversation_id=primeira["conversation_id"])

        assert motor.call_args.args[3] == relatorio.id

    def test_o_motor_so_recebe_as_ultimas_mensagens(self, client, ana, liberados, relatorio, ia, db_session):
        primeira = _chat(client, ana).json()
        conversa = db_session.query(AIConversation).get(primeira["conversation_id"])
        for i in range(30):
            db_session.add(AIMessage(conversation_id=conversa.id, role="user" if i % 2 == 0 else "assistant", content=f"m{i}"))
        db_session.commit()

        with patch.object(chat_engine, "answer_question", wraps=chat_engine.answer_question) as motor:
            _chat(client, ana, "Pergunta nova", conversation_id=conversa.id)

        enviadas = motor.call_args.args[2]
        assert len(enviadas) == chat_history.HISTORY_FOR_ENGINE + 1
        assert enviadas[-1] == {"role": "user", "content": "Pergunta nova"}
        assert enviadas[-2]["content"] == "m29"

    def test_conversa_de_outra_pessoa_e_404_e_nao_chama_a_ia(self, client, ana, beto, liberados, relatorio, ia):
        da_ana = _chat(client, ana).json()["conversation_id"]
        ia["chamadas"].clear()

        resp = _chat(client, beto, "Oi", conversation_id=da_ana)

        assert resp.status_code == 404 and ia["chamadas"] == []

    def test_conversa_inexistente_e_404(self, client, ana, liberados, relatorio, ia):
        assert _chat(client, ana, conversation_id=9999).status_code == 404

    def test_conversa_cheia_pede_para_comecar_outra(self, client, ana, liberados, relatorio, ia, db_session):
        conversa_id = _chat(client, ana).json()["conversation_id"]
        for i in range(chat_history.MAX_CONVERSATION_MESSAGES):
            db_session.add(AIMessage(conversation_id=conversa_id, role="user", content="x"))
        db_session.commit()
        ia["chamadas"].clear()

        resp = _chat(client, ana, "Mais uma", conversation_id=conversa_id)

        assert resp.status_code == 400 and "Comece uma nova" in resp.json()["detail"]
        assert ia["chamadas"] == []

    def test_erro_da_ia_na_primeira_pergunta_nao_deixa_nada_guardado(self, client, ana, liberados, relatorio, ia, db_session):
        ia["erro"] = AIError("O provedor recusou a chave de API.")

        assert _chat(client, ana).status_code == 502

        assert db_session.query(AIConversation).count() == 0 and db_session.query(AIMessage).count() == 0

    def test_erro_da_ia_ao_continuar_nao_deixa_pergunta_solta(self, client, ana, liberados, relatorio, ia, db_session):
        conversa_id = _chat(client, ana).json()["conversation_id"]
        ia["erro"] = AIError("fora do ar")

        assert _chat(client, ana, "E agora?", conversation_id=conversa_id).status_code == 502

        assert db_session.query(AIMessage).count() == 2

    def test_a_conversa_sobe_na_lista_quando_recebe_mensagem_nova(self, client, ana, liberados, relatorio, ia, db_session):
        antiga = _chat(client, ana, "Primeira").json()["conversation_id"]
        _chat(client, ana, "Segunda")
        _antiga(db_session, antiga, 5)
        _antiga(db_session, db_session.query(AIConversation).filter(AIConversation.title == "Segunda").one().id, 3)

        _chat(client, ana, "Voltei", conversation_id=antiga)

        titulos = [c["title"] for c in client.get("/ai/conversations/", headers=ana).json()]
        assert titulos == ["Primeira", "Segunda"]


class TestVerHistorico:
    def test_exige_estar_logado(self, client):
        assert client.get("/ai/conversations/").status_code == 401
        assert client.get("/ai/conversations/1").status_code == 401

    def test_so_quem_pode_usar_o_chat_ve_o_historico(self, client, admin, ana, relatorio, ia):
        assert client.get("/ai/conversations/", headers=ana).status_code == 403
        assert client.get("/ai/conversations/1", headers=ana).status_code == 403

    def test_cada_pessoa_ve_so_as_proprias_conversas(self, client, ana, beto, liberados, relatorio, ia):
        _chat(client, ana, "Pergunta da Ana")
        _chat(client, beto, "Pergunta do Beto")

        titulos_ana = [c["title"] for c in client.get("/ai/conversations/", headers=ana).json()]
        titulos_beto = [c["title"] for c in client.get("/ai/conversations/", headers=beto).json()]

        assert titulos_ana == ["Pergunta da Ana"] and titulos_beto == ["Pergunta do Beto"]

    def test_a_lista_vem_da_mais_recente_para_a_mais_antiga(self, client, ana, liberados, relatorio, ia, db_session):
        for texto in ("A", "B", "C"):
            _chat(client, ana, texto)
        ids = {c.title: c.id for c in db_session.query(AIConversation).all()}
        _antiga(db_session, ids["A"], 1)
        _antiga(db_session, ids["B"], 3)
        _antiga(db_session, ids["C"], 2)

        assert [c["title"] for c in client.get("/ai/conversations/", headers=ana).json()] == ["A", "C", "B"]

    def test_detalhe_traz_as_mensagens_com_relatorio_e_dax_mas_sem_tabela(self, client, ana, liberados, relatorio, ia):
        conversa_id = _chat(client, ana, "Qual o total?").json()["conversation_id"]

        corpo = client.get(f"/ai/conversations/{conversa_id}", headers=ana).json()

        assert corpo["title"] == "Qual o total?"
        usuario, assistente = corpo["messages"]
        assert (usuario["role"], usuario["content"], usuario["report"], usuario["dax"]) == ("user", "Qual o total?", None, None)
        assert assistente["content"] == "O total foi 99."
        assert assistente["report"] == {"id": relatorio.id, "name": "Vendas do mes"}
        assert assistente["dax"] == 'EVALUATE ROW("t", [Total])'
        assert "table" not in assistente and "rows" not in assistente

    def test_o_nome_do_relatorio_continua_certo_se_ele_for_apagado(self, client, ana, liberados, relatorio, ia, db_session):
        conversa_id = _chat(client, ana).json()["conversation_id"]
        db_session.delete(relatorio)
        db_session.commit()

        assistente = client.get(f"/ai/conversations/{conversa_id}", headers=ana).json()["messages"][1]

        assert assistente["report"]["name"] == "Vendas do mes"

    def test_conversa_de_outra_pessoa_e_404(self, client, ana, beto, liberados, relatorio, ia):
        da_ana = _chat(client, ana).json()["conversation_id"]

        assert client.get(f"/ai/conversations/{da_ana}", headers=beto).status_code == 404

    def test_nem_o_administrador_le_a_conversa_de_outra_pessoa(self, client, admin, ana, liberados, relatorio, ia):
        da_ana = _chat(client, ana).json()["conversation_id"]

        assert client.get(f"/ai/conversations/{da_ana}", headers=admin).status_code == 404

    def test_datas_saem_com_fuso(self, client, ana, liberados, relatorio, ia):
        _chat(client, ana)

        data = client.get("/ai/conversations/", headers=ana).json()[0]["updated_at"]

        assert data.endswith("Z") or "+" in data[10:] or "-" in data[10:]


class TestApagar:
    def test_apagar_uma_conversa_leva_as_mensagens(self, client, ana, liberados, relatorio, ia, db_session):
        conversa_id = _chat(client, ana).json()["conversation_id"]

        assert client.delete(f"/ai/conversations/{conversa_id}", headers=ana).status_code == 204

        assert db_session.query(AIConversation).count() == 0 and db_session.query(AIMessage).count() == 0
        assert client.get(f"/ai/conversations/{conversa_id}", headers=ana).status_code == 404

    def test_nao_apaga_conversa_de_outra_pessoa(self, client, ana, beto, liberados, relatorio, ia, db_session):
        da_ana = _chat(client, ana).json()["conversation_id"]

        assert client.delete(f"/ai/conversations/{da_ana}", headers=beto).status_code == 404

        assert db_session.query(AIConversation).count() == 1

    def test_apagar_tudo_so_apaga_as_minhas(self, client, ana, beto, liberados, relatorio, ia, db_session):
        _chat(client, ana, "A1")
        _chat(client, ana, "A2")
        _chat(client, beto, "B1")

        assert client.delete("/ai/conversations/", headers=ana).status_code == 204

        assert [c.title for c in db_session.query(AIConversation).all()] == ["B1"]
        assert db_session.query(AIMessage).count() == 2

    def test_quem_perdeu_a_permissao_ainda_apaga_o_que_e_dele(self, client, admin, ana, liberados, relatorio, ia, db_session):
        conversa_id = _chat(client, ana).json()["conversation_id"]
        grupos = client.get("/groups/", headers=admin).json()
        for grupo in grupos:
            client.put(f"/groups/{grupo['id']}/permissions", json={"permissions": []}, headers=admin) if not grupo["is_admin_group"] else None
        assert client.get("/ai/conversations/", headers=ana).status_code == 403

        assert client.delete(f"/ai/conversations/{conversa_id}", headers=ana).status_code == 204
        assert db_session.query(AIConversation).count() == 0

    def test_exige_estar_logado(self, client):
        assert client.delete("/ai/conversations/1").status_code == 401
        assert client.delete("/ai/conversations/").status_code == 401

    def test_registra_na_auditoria_sem_o_texto_das_conversas(self, client, ana, liberados, relatorio, ia, db_session):
        conversa_id = _chat(client, ana, "Qual o salario do fulano?").json()["conversation_id"]
        _chat(client, ana, "Outra")

        client.delete(f"/ai/conversations/{conversa_id}", headers=ana)
        client.delete("/ai/conversations/", headers=ana)

        unica = db_session.query(AuditLog).filter(AuditLog.action == "delete_ai_conversation").one()
        todas = db_session.query(AuditLog).filter(AuditLog.action == "delete_all_ai_conversations").one()
        assert unica.entity_id == str(conversa_id) and todas.details == "1 conversas"
        assert "salario" not in (unica.details or "") and "salario" not in (todas.details or "")


class TestRetencao:
    def _conversa(self, db, user_id, dias, titulo="x"):
        agora = datetime.now(timezone.utc)
        conversa = AIConversation(user_id=user_id, title=titulo, created_at=agora, updated_at=agora - timedelta(days=dias))
        db.add(conversa)
        db.commit()
        db.add(AIMessage(conversation_id=conversa.id, role="user", content="oi"))
        db.commit()
        return conversa

    def test_apaga_o_que_passou_de_trinta_dias_e_mantem_o_resto(self, db_session, make_user):
        usuario = make_user("a@example.com")
        velha = self._conversa(db_session, usuario.id, 31, "velha")
        recente = self._conversa(db_session, usuario.id, 29, "recente")
        velha_id, recente_id = velha.id, recente.id  # a velha deixa de existir depois da limpeza

        removidas = chat_history.purge_expired(db_session)

        assert removidas == 1
        assert [c.title for c in db_session.query(AIConversation).all()] == ["recente"]
        assert db_session.query(AIMessage).filter(AIMessage.conversation_id == velha_id).count() == 0
        assert db_session.query(AIMessage).filter(AIMessage.conversation_id == recente_id).count() == 1

    def test_conta_a_partir_da_ultima_mensagem_nao_da_criacao(self, db_session, make_user):
        usuario = make_user("a@example.com")
        conversa = self._conversa(db_session, usuario.id, 2)
        conversa.created_at = datetime.now(timezone.utc) - timedelta(days=400)
        db_session.commit()

        assert chat_history.purge_expired(db_session) == 0

    def test_o_prazo_vem_da_configuracao_do_admin(self, db_session, make_user):
        from app.core import ai_options

        usuario = make_user("a@example.com")
        self._conversa(db_session, usuario.id, 10)
        ai_options.get_settings_row(db_session).ai_retention_days = 7
        db_session.commit()

        assert chat_history.purge_expired(db_session) == 1

    def test_sem_nada_vencido_nao_apaga_nada(self, db_session, make_user):
        usuario = make_user("a@example.com")
        self._conversa(db_session, usuario.id, 1)

        assert chat_history.purge_expired(db_session) == 0 and db_session.query(AIConversation).count() == 1

    def test_o_processo_de_limpeza_roda_uma_rodada_e_devolve_quantas(self, db_session, make_user, monkeypatch):
        usuario = make_user("a@example.com")
        self._conversa(db_session, usuario.id, 40)
        monkeypatch.setattr(ai_history_runner, "SessionLocal", lambda: db_session)

        assert ai_history_runner.run_once() == 1
        assert db_session.query(AIConversation).count() == 0

    def test_o_processo_comeca_e_para(self):
        with patch.object(ai_history_runner, "run_once", return_value=0):
            ai_history_runner.start()
            ai_history_runner.stop()

        assert ai_history_runner._stop.is_set()


class TestExcluirUsuario:
    def test_excluir_a_conta_leva_o_historico_junto(self, client, admin, ana, liberados, relatorio, ia, db_session):
        _chat(client, ana)
        usuario_id = db_session.query(User).filter(User.email == "ana@example.com").one().id

        assert client.delete(f"/users/{usuario_id}", headers=admin).status_code == 204

        assert db_session.query(AIConversation).count() == 0 and db_session.query(AIMessage).count() == 0

    def test_nao_mexe_no_historico_dos_outros(self, client, admin, ana, beto, liberados, relatorio, ia, db_session):
        _chat(client, ana, "Da Ana")
        _chat(client, beto, "Do Beto")
        ana_id = db_session.query(User).filter(User.email == "ana@example.com").one().id

        client.delete(f"/users/{ana_id}", headers=admin)

        assert [c.title for c in db_session.query(AIConversation).all()] == ["Do Beto"]


class TestOpcoes:
    def test_exige_estar_logado(self, client):
        assert client.get("/ai/options/").status_code == 401
        assert client.put("/ai/options/", json={"retention_days": 7}).status_code == 401

    def test_quem_so_usa_o_chat_nao_ve_nem_muda(self, client, ana, liberados):
        assert client.get("/ai/options/", headers=ana).status_code == 403
        assert client.put("/ai/options/", json={"retention_days": 7}, headers=ana).status_code == 403

    def test_o_padrao_e_trinta_dias(self, client, admin):
        assert client.get("/ai/options/", headers=admin).json() == {
            "retention_days": 30,
            "default_retention_days": 30,
            "daily_question_limit": 50,
            "default_daily_question_limit": 50,
            "openrouter_monthly_budget_usd": None,
        }

    def test_muda_o_prazo_e_guarda(self, client, admin):
        resp = client.put("/ai/options/", json={"retention_days": 7}, headers=admin)

        assert resp.json()["retention_days"] == 7
        assert client.get("/ai/options/", headers=admin).json()["retention_days"] == 7

    def test_pedido_sem_prazo_mantem_o_atual(self, client, admin):
        client.put("/ai/options/", json={"retention_days": 7}, headers=admin)

        assert client.put("/ai/options/", json={}, headers=admin).json()["retention_days"] == 7

    @pytest.mark.parametrize("dias", [0, -1, 3651, "abc", 1.5])
    def test_prazo_fora_do_intervalo_e_recusado(self, client, admin, dias):
        assert client.put("/ai/options/", json={"retention_days": dias}, headers=admin).status_code == 422

    def test_limites_do_intervalo_sao_aceitos(self, client, admin):
        assert client.put("/ai/options/", json={"retention_days": 1}, headers=admin).status_code == 200
        assert client.put("/ai/options/", json={"retention_days": 3650}, headers=admin).status_code == 200

    def test_a_mudanca_vale_para_a_limpeza(self, client, admin, db_session, make_user):
        usuario = make_user("velho@example.com")
        agora = datetime.now(timezone.utc)
        db_session.add(AIConversation(user_id=usuario.id, title="x", created_at=agora, updated_at=agora - timedelta(days=10)))
        db_session.commit()
        client.put("/ai/options/", json={"retention_days": 7}, headers=admin)

        assert chat_history.purge_expired(db_session) == 1

    def test_quem_so_gerencia_a_ia_tambem_muda(self, client, admin, ana):
        grupo = client.post("/groups/", json={"name": "Gestores"}, headers=admin).json()["id"]
        client.post(f"/groups/{grupo}/members", json={"email": "ana@example.com"}, headers=admin)
        client.put(f"/groups/{grupo}/permissions", json={"permissions": ["ia.gerenciar"]}, headers=admin)

        assert client.put("/ai/options/", json={"retention_days": 14}, headers=ana).status_code == 200

    def test_registra_na_auditoria(self, client, admin, db_session):
        client.put("/ai/options/", json={"retention_days": 14}, headers=admin)

        log = db_session.query(AuditLog).filter(AuditLog.action == "update_ai_options").one()
        assert log.details == "retention_days=14"

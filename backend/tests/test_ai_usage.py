"""Consumo do chat de IA: limite de perguntas por dia, orcamento mensal do OpenRouter, custo por
pergunta, relatorio do admin e as opcoes novas. Dia e mes seguem o fuso do sistema."""

import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.core import ai_options, ai_pricing, ai_providers, ai_usage, chat_dataset
from app.core.ai_providers import AIResult
from app.core.chat_dataset import ChatDataError, ChatQueryResult, DatasetSchema, SchemaColumn, SchemaTable
from app.core.workspace_deps import ensure_default_group_access
from app.models.ai_usage import AIUsage
from app.models.audit_log import AuditLog
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.user import User
from app.models.workspace import Workspace

PASSWORD = "SenhaForte123"
ESQUEMA = DatasetSchema(tables=(SchemaTable("Vendas", (SchemaColumn("Valor", "decimal"),), (("Total", None),)),))
RESULTADO = ChatQueryResult(columns=["[Total]"], rows=[{"[Total]": 99}], total_rows=1, truncated=False)
PRECOS = {
    "data": [{"id": "modelo-x", "pricing": {"prompt": "0.000001", "completion": "0.000002"}}]
}  # 24 tokens de entrada e 8 de saida custam 0,00004


def _headers(client, email: str) -> dict:
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(client):
    return _headers(client, "admin@example.com")  # a primeira conta cadastrada e administradora


@pytest.fixture
def ana(client, admin):
    return _headers(client, "ana@example.com")


@pytest.fixture
def beto(client, admin):
    return _headers(client, "beto@example.com")


def _usuario(db, email) -> User:
    return db.query(User).filter(User.email == email).one()


def _uso(db, user, quando=None, provider="openrouter", model="modelo-x", custo=0.01, tin=100, tout=50):
    db.add(
        AIUsage(
            created_at=quando or datetime.now(timezone.utc),
            user_id=user.id if user else None,
            user_email=user.email if user else "apagado@example.com",
            provider=provider,
            model=model,
            llm_calls=2,
            input_tokens=tin,
            output_tokens=tout,
            cost_usd=custo,
        )
    )
    db.commit()


class TestFuso:
    def test_o_dia_comeca_a_meia_noite_do_fuso_do_sistema(self, db_session):
        # 02:30 UTC de 10/11 ainda e 23:30 de 09/11 em Sao Paulo (UTC-3)
        agora = datetime(2026, 11, 10, 2, 30, tzinfo=timezone.utc)

        assert ai_usage.day_start_utc(db_session, agora) == datetime(2026, 11, 9, 3, 0, tzinfo=timezone.utc)

    def test_o_mes_comeca_no_dia_um_a_meia_noite_do_fuso(self, db_session):
        agora = datetime(2026, 12, 1, 1, 0, tzinfo=timezone.utc)  # ainda 30/11 em Sao Paulo

        assert ai_usage.month_start_utc(db_session, agora) == datetime(2026, 11, 1, 3, 0, tzinfo=timezone.utc)

    def test_usa_o_fuso_configurado(self, db_session):
        ai_options.get_settings_row(db_session).timezone = "UTC"
        db_session.commit()
        agora = datetime(2026, 11, 10, 2, 30, tzinfo=timezone.utc)

        assert ai_usage.day_start_utc(db_session, agora) == datetime(2026, 11, 10, 0, 0, tzinfo=timezone.utc)

    def test_fuso_invalido_cai_para_utc(self, db_session):
        ai_options.get_settings_row(db_session).timezone = "Marte/Olimpo"
        db_session.commit()
        agora = datetime(2026, 11, 10, 2, 30, tzinfo=timezone.utc)

        assert ai_usage.day_start_utc(db_session, agora) == datetime(2026, 11, 10, 0, 0, tzinfo=timezone.utc)


class TestLimiteDiario:
    def test_padrao_e_cinquenta(self, db_session, make_user):
        usuario = make_user("a@example.com")
        for _ in range(49):
            _uso(db_session, usuario)

        ai_usage.check_limits(db_session, usuario.id, "openai")  # nao levanta

        _uso(db_session, usuario)
        with pytest.raises(ai_usage.LimitReached, match="limite de 50 perguntas por dia"):
            ai_usage.check_limits(db_session, usuario.id, "openai")

    def test_o_limite_vem_da_configuracao(self, db_session, make_user):
        usuario = make_user("a@example.com")
        ai_options.get_settings_row(db_session).ai_daily_question_limit = 2
        db_session.commit()
        _uso(db_session, usuario)
        ai_usage.check_limits(db_session, usuario.id, "openai")
        _uso(db_session, usuario)

        with pytest.raises(ai_usage.LimitReached, match="limite de 2 perguntas"):
            ai_usage.check_limits(db_session, usuario.id, "openai")

    def test_zero_quer_dizer_sem_limite(self, db_session, make_user):
        usuario = make_user("a@example.com")
        ai_options.get_settings_row(db_session).ai_daily_question_limit = 0
        db_session.commit()
        for _ in range(80):
            _uso(db_session, usuario)

        ai_usage.check_limits(db_session, usuario.id, "openai")  # nao levanta

    def test_cada_pessoa_tem_a_sua_cota(self, db_session, make_user):
        ana, beto = make_user("ana@example.com"), make_user("beto@example.com")
        ai_options.get_settings_row(db_session).ai_daily_question_limit = 1
        db_session.commit()
        _uso(db_session, ana)

        ai_usage.check_limits(db_session, beto.id, "openai")  # nao levanta
        with pytest.raises(ai_usage.LimitReached):
            ai_usage.check_limits(db_session, ana.id, "openai")

    def test_o_dia_de_ontem_nao_conta(self, db_session, make_user):
        usuario = make_user("a@example.com")
        ai_options.get_settings_row(db_session).ai_daily_question_limit = 1
        db_session.commit()
        comeco = ai_usage.day_start_utc(db_session)
        _uso(db_session, usuario, quando=comeco - timedelta(minutes=1))

        ai_usage.check_limits(db_session, usuario.id, "openai")  # nao levanta

        _uso(db_session, usuario, quando=comeco)
        with pytest.raises(ai_usage.LimitReached):
            ai_usage.check_limits(db_session, usuario.id, "openai")


class TestOrcamento:
    def _orcamento(self, db, valor):
        ai_options.get_settings_row(db).ai_openrouter_monthly_budget = valor
        ai_options.get_settings_row(db).ai_daily_question_limit = 0
        db.commit()

    def test_estourou_o_orcamento_do_mes_bloqueia_o_openrouter(self, db_session, make_user):
        usuario = make_user("a@example.com")
        self._orcamento(db_session, 0.05)
        _uso(db_session, usuario, custo=0.03)
        ai_usage.check_limits(db_session, usuario.id, "openrouter")  # 0,03 de 0,05: ainda pode

        _uso(db_session, usuario, custo=0.02)
        with pytest.raises(ai_usage.LimitReached, match="orcamento mensal do OpenRouter"):
            ai_usage.check_limits(db_session, usuario.id, "openrouter")

    def test_o_orcamento_vale_para_todas_as_pessoas_juntas(self, db_session, make_user):
        ana, beto = make_user("ana@example.com"), make_user("beto@example.com")
        self._orcamento(db_session, 0.05)
        _uso(db_session, ana, custo=0.06)

        with pytest.raises(ai_usage.LimitReached):
            ai_usage.check_limits(db_session, beto.id, "openrouter")

    @pytest.mark.parametrize("provedor", ["openai", "gemini", "anthropic", "nvidia"])
    def test_os_outros_provedores_nao_sao_afetados(self, db_session, make_user, provedor):
        usuario = make_user("a@example.com")
        self._orcamento(db_session, 0.05)
        _uso(db_session, usuario, custo=10.0)

        ai_usage.check_limits(db_session, usuario.id, provedor)  # nao levanta

    def test_gasto_de_outro_provedor_nao_entra_na_conta_do_openrouter(self, db_session, make_user):
        usuario = make_user("a@example.com")
        self._orcamento(db_session, 0.05)
        _uso(db_session, usuario, provider="openai", custo=10.0)

        ai_usage.check_limits(db_session, usuario.id, "openrouter")  # nao levanta

    def test_sem_orcamento_ou_com_zero_nao_bloqueia(self, db_session, make_user):
        usuario = make_user("a@example.com")
        _uso(db_session, usuario, custo=999.0)
        for valor in (None, 0.0):
            self._orcamento(db_session, valor)
            ai_usage.check_limits(db_session, usuario.id, "openrouter")  # nao levanta

    def test_o_mes_passado_nao_conta(self, db_session, make_user):
        usuario = make_user("a@example.com")
        self._orcamento(db_session, 0.05)
        _uso(db_session, usuario, quando=ai_usage.month_start_utc(db_session) - timedelta(minutes=1), custo=5.0)

        ai_usage.check_limits(db_session, usuario.id, "openrouter")  # nao levanta

    def test_pergunta_sem_preco_nao_soma(self, db_session, make_user):
        usuario = make_user("a@example.com")
        self._orcamento(db_session, 0.05)
        _uso(db_session, usuario, custo=None)

        ai_usage.check_limits(db_session, usuario.id, "openrouter")  # nao levanta


class TestResumo:
    def test_totais_por_pessoa_e_por_modelo(self, db_session, make_user):
        ana, beto = make_user("ana@example.com"), make_user("beto@example.com")
        _uso(db_session, ana, tin=100, tout=10, custo=0.01)
        _uso(db_session, ana, tin=200, tout=20, custo=0.02)
        _uso(db_session, beto, provider="openai", model="gpt-x", tin=50, tout=5, custo=None)

        resumo = ai_usage.summarize(db_session, 30)

        assert resumo["totals"] == {
            "questions": 3,
            "input_tokens": 350,
            "output_tokens": 35,
            "cost_usd": 0.03,
            "unpriced_questions": 0,  # a sem preco e do OpenAI, que nao tem tabela de precos
        }
        assert [(r["email"], r["questions"], r["input_tokens"], r["cost_usd"]) for r in resumo["by_user"]] == [
            ("ana@example.com", 2, 300, 0.03),
            ("beto@example.com", 1, 50, 0.0),
        ]
        assert [(r["provider"], r["model"], r["questions"]) for r in resumo["by_model"]] == [
            ("openrouter", "modelo-x", 2),
            ("openai", "gpt-x", 1),
        ]

    def test_conta_as_perguntas_do_openrouter_sem_preco(self, db_session, make_user):
        usuario = make_user("a@example.com")
        _uso(db_session, usuario, model="modelo-sem-preco", custo=None)
        _uso(db_session, usuario, custo=0.01)

        resumo = ai_usage.summarize(db_session, 30)

        assert resumo["totals"]["unpriced_questions"] == 1
        assert resumo["by_user"][0]["unpriced_questions"] == 1
        assert resumo["openrouter_budget"]["unpriced_questions_month"] == 1

    def test_so_olha_o_periodo_pedido(self, db_session, make_user):
        usuario = make_user("a@example.com")
        _uso(db_session, usuario, quando=datetime.now(timezone.utc) - timedelta(days=10))
        _uso(db_session, usuario)

        assert ai_usage.summarize(db_session, 5)["totals"]["questions"] == 1
        assert ai_usage.summarize(db_session, 30)["totals"]["questions"] == 2

    def test_conta_excluida_continua_no_consumo_pelo_email(self, db_session):
        _uso(db_session, None)

        linha = ai_usage.summarize(db_session, 30)["by_user"][0]

        assert (linha["user_id"], linha["email"]) == (None, "apagado@example.com")

    def test_sem_nenhum_uso_tudo_zerado(self, db_session):
        resumo = ai_usage.summarize(db_session, 30)

        assert resumo["totals"] == {
            "questions": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "unpriced_questions": 0
        }
        assert resumo["by_user"] == [] and resumo["by_model"] == []

    def test_situacao_do_orcamento(self, db_session, make_user):
        usuario = make_user("a@example.com")
        ai_options.get_settings_row(db_session).ai_openrouter_monthly_budget = 0.05
        db_session.commit()
        _uso(db_session, usuario, custo=0.02)

        orcamento = ai_usage.summarize(db_session, 30)["openrouter_budget"]

        assert orcamento["monthly_usd"] == 0.05 and orcamento["spent_month_usd"] == 0.02
        assert orcamento["remaining_usd"] == 0.03 and orcamento["blocked"] is False

        _uso(db_session, usuario, custo=0.04)
        orcamento = ai_usage.summarize(db_session, 30)["openrouter_budget"]
        assert orcamento["blocked"] is True and orcamento["remaining_usd"] == 0.0

    def test_sem_orcamento_nao_ha_restante_nem_bloqueio(self, db_session):
        orcamento = ai_usage.summarize(db_session, 30)["openrouter_budget"]

        assert (orcamento["monthly_usd"], orcamento["remaining_usd"], orcamento["blocked"]) == (None, None, False)

    def test_ordem_das_pessoas_e_pelas_perguntas_e_depois_pelo_email(self, db_session, make_user):
        zeca, ana, beto = make_user("zeca@example.com"), make_user("ana@example.com"), make_user("beto@example.com")
        for usuario, vezes in ((zeca, 3), (ana, 1), (beto, 1)):
            for _ in range(vezes):
                _uso(db_session, usuario)

        assert [r["email"] for r in ai_usage.summarize(db_session, 30)["by_user"]] == [
            "zeca@example.com", "ana@example.com", "beto@example.com"
        ]


class TestOpcoesNovas:
    def test_muda_limite_e_orcamento(self, client, admin):
        resp = client.put(
            "/ai/options/", json={"daily_question_limit": 10, "openrouter_monthly_budget_usd": 25.5}, headers=admin
        )

        assert resp.status_code == 200
        assert (resp.json()["daily_question_limit"], resp.json()["openrouter_monthly_budget_usd"]) == (10, 25.5)

    def test_limite_zero_e_aceito_e_quer_dizer_sem_limite(self, client, admin):
        resp = client.put("/ai/options/", json={"daily_question_limit": 0}, headers=admin)

        assert resp.json()["daily_question_limit"] == 0

    def test_orcamento_zero_tira_o_orcamento(self, client, admin):
        client.put("/ai/options/", json={"openrouter_monthly_budget_usd": 10}, headers=admin)

        resp = client.put("/ai/options/", json={"openrouter_monthly_budget_usd": 0}, headers=admin)

        assert resp.json()["openrouter_monthly_budget_usd"] is None

    def test_pedido_parcial_mantem_o_resto(self, client, admin):
        client.put("/ai/options/", json={"retention_days": 7, "daily_question_limit": 9}, headers=admin)

        corpo = client.put("/ai/options/", json={"openrouter_monthly_budget_usd": 3}, headers=admin).json()

        assert (corpo["retention_days"], corpo["daily_question_limit"], corpo["openrouter_monthly_budget_usd"]) == (7, 9, 3)

    @pytest.mark.parametrize(
        "corpo",
        [
            {"daily_question_limit": -1},
            {"daily_question_limit": 100001},
            {"daily_question_limit": 1.5},
            {"openrouter_monthly_budget_usd": -0.01},
            {"openrouter_monthly_budget_usd": 1_000_001},
            {"openrouter_monthly_budget_usd": "abc"},
        ],
    )
    def test_valores_fora_do_intervalo_sao_recusados(self, client, admin, corpo):
        assert client.put("/ai/options/", json=corpo, headers=admin).status_code == 422

    def test_auditoria_traz_so_o_que_mudou(self, client, admin, db_session):
        client.put("/ai/options/", json={"daily_question_limit": 10, "openrouter_monthly_budget_usd": 5}, headers=admin)

        log = db_session.query(AuditLog).filter(AuditLog.action == "update_ai_options").one()
        assert log.details == "daily_question_limit=10, openrouter_monthly_budget_usd=5.0"


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
    """Provedor openrouter escolhido, IA e Power BI simulados (cada chamada: 12 tokens de entrada, 4 de saida)."""
    client.put(
        "/settings/ai/openrouter",
        json={"api_key": "chave-x", "model": "modelo-x", "enabled": True, "chat_default": True},
        headers=admin,
    )
    estado = {"chamadas": 0}

    def fake_complete(provider, api_key, model, messages, max_tokens=1024):
        estado["chamadas"] += 1
        if "Modelo de dados" in messages[0]["content"]:
            return AIResult(json.dumps({"dax": 'EVALUATE ROW("t", [Total])'}), 12, 4)
        return AIResult("O total foi 99.", 12, 4)

    monkeypatch.setattr(ai_providers, "complete", fake_complete)
    monkeypatch.setattr(chat_dataset, "get_dataset_schema", lambda connection, report: ESQUEMA)
    monkeypatch.setattr(chat_dataset, "run_chat_query", lambda connection, report, dax, blocked=(): RESULTADO)
    return estado


def _precos(monkeypatch, corpo=PRECOS, status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=corpo)

    monkeypatch.setattr(ai_providers, "_http", httpx.Client(transport=httpx.MockTransport(handler)))
    ai_pricing.clear_cache()


def _chat(client, headers, texto="Qual o total?"):
    return client.post("/ai/chat", json={"message": texto}, headers=headers)


def _liberar(client, admin, email):
    grupo = client.post("/groups/", json={"name": f"G {email}"}, headers=admin).json()["id"]
    client.post(f"/groups/{grupo}/members", json={"email": email}, headers=admin)
    client.put(f"/groups/{grupo}/permissions", json={"permissions": ["ia.usar"]}, headers=admin)


@pytest.fixture
def liberados(client, admin, ana, beto):
    _liberar(client, admin, "ana@example.com")
    _liberar(client, admin, "beto@example.com")


class TestNoChat:
    def test_registra_a_pergunta_com_tokens_e_custo(self, client, ana, liberados, relatorio, ia, monkeypatch, db_session):
        _precos(monkeypatch)

        resp = _chat(client, ana)

        assert resp.status_code == 200
        assert resp.json()["usage"]["cost_usd"] == pytest.approx(0.00004)  # 24 x 0,000001 + 8 x 0,000002
        linha = db_session.query(AIUsage).one()
        assert (linha.user_email, linha.provider, linha.model, linha.report_id) == (
            "ana@example.com", "openrouter", "modelo-x", relatorio.id
        )
        assert (linha.llm_calls, linha.input_tokens, linha.output_tokens) == (2, 24, 8)
        assert linha.cost_usd == pytest.approx(0.00004)

    def test_modelo_sem_preco_registra_sem_custo_e_aparece_como_sem_preco(
        self, client, admin, ana, liberados, relatorio, ia, monkeypatch, db_session
    ):
        _precos(monkeypatch, {"data": []})

        resp = _chat(client, ana)

        assert resp.status_code == 200 and resp.json()["usage"]["cost_usd"] is None
        assert db_session.query(AIUsage).one().cost_usd is None
        assert client.get("/ai/usage/", headers=admin).json()["totals"]["unpriced_questions"] == 1

    def test_openrouter_fora_do_ar_nao_derruba_o_chat(self, client, ana, liberados, relatorio, ia, monkeypatch):
        _precos(monkeypatch, status=500)

        resp = _chat(client, ana)

        assert resp.status_code == 200 and resp.json()["usage"]["cost_usd"] is None

    def test_provedor_sem_tabela_de_precos_nao_tem_custo(self, client, admin, ana, liberados, relatorio, ia, db_session):
        client.put("/settings/ai/gemini", json={"api_key": "k", "model": "gem", "enabled": True, "chat_default": True}, headers=admin)

        resp = _chat(client, ana)

        assert resp.json()["usage"]["provider"] == "gemini" and resp.json()["usage"]["cost_usd"] is None
        assert db_session.query(AIUsage).one().provider == "gemini"

    def test_limite_diario_bloqueia_a_proxima_sem_chamar_a_ia(self, client, admin, ana, liberados, relatorio, ia):
        client.put("/ai/options/", json={"daily_question_limit": 2}, headers=admin)
        assert _chat(client, ana).status_code == 200 and _chat(client, ana).status_code == 200
        chamadas = ia["chamadas"]

        resp = _chat(client, ana)

        assert resp.status_code == 429
        assert "limite de 2 perguntas por dia" in resp.json()["detail"]
        assert ia["chamadas"] == chamadas

    def test_o_limite_de_uma_pessoa_nao_trava_a_outra(self, client, admin, ana, beto, liberados, relatorio, ia):
        client.put("/ai/options/", json={"daily_question_limit": 1}, headers=admin)
        _chat(client, ana)

        assert _chat(client, ana).status_code == 429
        assert _chat(client, beto).status_code == 200

    def test_limite_zero_libera_geral(self, client, admin, ana, liberados, relatorio, ia):
        client.put("/ai/options/", json={"daily_question_limit": 0}, headers=admin)

        assert all(_chat(client, ana).status_code == 200 for _ in range(5))

    def test_resposta_sem_chamar_a_ia_nao_gasta_a_cota(self, client, admin, ana, liberados, relatorio, ia, monkeypatch, db_session):
        def bloqueado(connection, report):
            raise ChatDataError(chat_dataset.REASON_RLS)

        monkeypatch.setattr(chat_dataset, "get_dataset_schema", bloqueado)
        client.put("/ai/options/", json={"daily_question_limit": 1}, headers=admin)

        codigos = [_chat(client, ana).status_code for _ in range(3)]

        assert codigos == [200, 200, 200]
        assert db_session.query(AIUsage).count() == 0

    def test_falha_da_ia_nao_gasta_a_cota(self, client, admin, ana, liberados, relatorio, ia, monkeypatch, db_session):
        def quebra(provider, api_key, model, messages, max_tokens=1024):
            raise ai_providers.AIError("fora do ar")

        monkeypatch.setattr(ai_providers, "complete", quebra)
        client.put("/ai/options/", json={"daily_question_limit": 1}, headers=admin)

        assert _chat(client, ana).status_code == 502
        assert db_session.query(AIUsage).count() == 0

    def test_orcamento_estourado_bloqueia_o_openrouter(self, client, admin, ana, liberados, relatorio, ia, db_session):
        client.put("/ai/options/", json={"openrouter_monthly_budget_usd": 0.01}, headers=admin)
        _uso(db_session, _usuario(db_session, "beto@example.com"), custo=0.02)

        resp = _chat(client, ana)

        assert resp.status_code == 429
        assert "orcamento mensal do OpenRouter" in resp.json()["detail"]
        assert ia["chamadas"] == 0

    def test_orcamento_estourado_nao_trava_outro_provedor(self, client, admin, ana, liberados, relatorio, ia, db_session):
        client.put("/ai/options/", json={"openrouter_monthly_budget_usd": 0.01}, headers=admin)
        _uso(db_session, _usuario(db_session, "beto@example.com"), custo=0.02)
        client.put("/settings/ai/gemini", json={"api_key": "k", "model": "gem", "enabled": True, "chat_default": True}, headers=admin)

        assert _chat(client, ana).status_code == 200

    def test_tirar_o_orcamento_destrava(self, client, admin, ana, liberados, relatorio, ia, db_session):
        client.put("/ai/options/", json={"openrouter_monthly_budget_usd": 0.01}, headers=admin)
        _uso(db_session, _usuario(db_session, "beto@example.com"), custo=0.02)
        assert _chat(client, ana).status_code == 429

        client.put("/ai/options/", json={"openrouter_monthly_budget_usd": 0}, headers=admin)

        assert _chat(client, ana).status_code == 200

    def test_sem_provedor_continua_503_e_nao_confunde_com_limite(self, client, ana, liberados, relatorio):
        assert _chat(client, ana).status_code == 503


class TestRelatorioDoAdmin:
    def test_exige_estar_logado(self, client):
        assert client.get("/ai/usage/").status_code == 401

    def test_quem_so_usa_o_chat_nao_ve_o_consumo_dos_outros(self, client, ana, liberados):
        assert client.get("/ai/usage/", headers=ana).status_code == 403

    def test_quem_gerencia_a_ia_ve(self, client, admin, ana):
        grupo = client.post("/groups/", json={"name": "Gestores"}, headers=admin).json()["id"]
        client.post(f"/groups/{grupo}/members", json={"email": "ana@example.com"}, headers=admin)
        client.put(f"/groups/{grupo}/permissions", json={"permissions": ["ia.gerenciar"]}, headers=admin)

        assert client.get("/ai/usage/", headers=ana).status_code == 200

    def test_traz_o_consumo_por_pessoa_e_o_que_foi_gasto(self, client, admin, ana, beto, liberados, relatorio, ia, monkeypatch):
        _precos(monkeypatch)
        _chat(client, ana)
        _chat(client, ana)
        _chat(client, beto)

        corpo = client.get("/ai/usage/", headers=admin).json()

        assert corpo["period_days"] == 30 and corpo["daily_limit"] == 50
        assert corpo["totals"]["questions"] == 3 and corpo["totals"]["input_tokens"] == 72
        assert [(u["email"], u["questions"]) for u in corpo["by_user"]] == [("ana@example.com", 2), ("beto@example.com", 1)]
        assert corpo["by_model"][0]["model"] == "modelo-x" and corpo["by_model"][0]["cost_usd"] == pytest.approx(0.00012)
        assert corpo["openrouter_budget"]["spent_month_usd"] == pytest.approx(0.00012)

    def test_aceita_o_periodo(self, client, admin):
        assert client.get("/ai/usage/?days=7", headers=admin).json()["period_days"] == 7

    @pytest.mark.parametrize("dias", [0, -1, 366, "abc"])
    def test_periodo_invalido(self, client, admin, dias):
        assert client.get(f"/ai/usage/?days={dias}", headers=admin).status_code == 422

    def test_nunca_traz_texto_de_conversa(self, client, admin, ana, liberados, relatorio, ia):
        _chat(client, ana, "Qual o salario do fulano de tal CPF 123?")

        texto = client.get("/ai/usage/", headers=admin).text

        for palavra in ("salario", "fulano", "CPF", "O total foi 99", "EVALUATE"):
            assert palavra not in texto

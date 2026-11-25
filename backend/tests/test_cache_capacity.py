"""v1.54.0, fase 5: chave do cache por relatorio, aberturas por hora, aquecimento so dos relatorios recentes e controle da
capacidade do Power BI. O Azure NUNCA e chamado: a rede fica bloqueada nos testes e a chamada real so passa por um cliente
HTTP simulado (`httpx.MockTransport`). Dados ficticios."""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.core import azure_capacity, report_stats
from app.core import powerbi as powerbi_core
from app.models.audit_log import AuditLog
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.report_grant import ReportCollection
from app.models.report_open_stat import ReportOpenStat
from app.models.settings import AppSettings
from app.routers import powerbi as embed_router
from tests.test_powerbi_cache_sharing import _embed, _headers_de, _setup, _token, _warm

SEMPRE_ABERTO = [{"days": [0, 1, 2, 3, 4, 5, 6], "start": "00:00", "end": "24:00"}]


class TestChaveDoCachePorRelatorio:
    def test_o_mesmo_relatorio_aberto_por_outra_pasta_reaproveita_o_token(self, client, db_session):
        admin, workspace, (report,) = _setup(client, ["ds-1"])
        outra = client.post("/workspaces/", json={"name": "Outra pasta"}, headers=admin).json()
        db_session.add(ReportCollection(report_id=report["id"], collection_id=outra["id"]))
        db_session.commit()
        generate = MagicMock(return_value=_token("unico"))

        r1 = _embed(client, admin, workspace, report, generate=generate)
        r2 = _embed(client, admin, outra, report, generate=generate)

        assert r1.status_code == r2.status_code == 200
        assert r2.json()["access_token"] == "unico"
        assert generate.call_count == 1

    def test_as_chaves_sao_as_do_relatorio_e_invalidar_limpa_qualquer_pasta(self, client, db_session):
        admin, workspace, (report,) = _setup(client, ["ds-1"])
        _embed(client, admin, workspace, report, generate=MagicMock(return_value=_token()))
        assert (workspace["id"], report["id"], None) in embed_router._embed_cache

        embed_router.invalidate_embed_cache(999, report["id"])  # pasta qualquer: o que vale e o relatorio

        assert not embed_router._embed_cache
        assert not embed_router._report_static_cache

    def test_com_funcoes_mapeadas_o_conjunto_de_funcoes_continua_na_chave(self):
        from app.core.dataset_security import EmbedIdentity

        a = EmbedIdentity(username="x", roles=("Gerente",), shared=False)
        b = EmbedIdentity(username="x", roles=("Vendas",), shared=False)

        assert a.cache_part(1) != b.cache_part(1)


class TestAberturasPorHora:
    def test_so_a_abertura_conta_e_nao_a_renovacao_do_token(self, client, db_session):
        admin, workspace, (report,) = _setup(client, ["ds-1"])
        generate = MagicMock(return_value=_token())

        _embed(client, admin, workspace, report, generate=generate)
        _embed(client, admin, workspace, report, generate=generate)  # dentro da janela: renovacao

        linhas = db_session.query(ReportOpenStat).filter(ReportOpenStat.report_id == report["id"]).all()
        assert len(linhas) == 1 and linhas[0].opens == 1

    def test_a_tela_mostra_os_mais_abertos_com_a_serie_por_hora(self, client, db_session):
        admin, workspace, (a, b) = _setup(client, ["ds-1", "ds-2"])
        agora = datetime(2026, 11, 25, 15, 30, tzinfo=timezone.utc)
        for _ in range(3):
            report_stats.record_open(db_session, a["id"], agora)
        report_stats.record_open(db_session, a["id"], agora - timedelta(hours=1))
        report_stats.record_open(db_session, b["id"], agora)

        dados = report_stats.openings(db_session, hours=6, now=agora)

        assert [r["report_id"] for r in dados["reports"]] == [a["id"], b["id"]]
        assert dados["reports"][0]["total"] == 4
        assert dados["reports"][0]["by_hour"] == {"2026-11-25T14": 1, "2026-11-25T15": 3}
        resposta = client.get("/cache-capacity/openings?hours=24", headers=admin)
        assert resposta.status_code == 200 and "reports" in resposta.json()

    def test_so_guarda_contagem_nunca_quem_abriu(self):
        colunas = {c.name for c in ReportOpenStat.__table__.columns}

        assert colunas == {"id", "report_id", "hour", "opens"}

    def test_apaga_contagens_antigas(self, db_session):
        _setup_report = Report(collection_id=1, name="R", pbi_workspace_id="w", pbi_report_id="r")
        db_session.add(_setup_report)
        db_session.commit()
        agora = datetime(2026, 11, 25, 15, tzinfo=timezone.utc)
        report_stats.record_open(db_session, _setup_report.id, agora - timedelta(days=40))
        report_stats.record_open(db_session, _setup_report.id, agora)

        apagadas = report_stats.prune(db_session, now=agora)

        assert apagadas == 1 and db_session.query(ReportOpenStat).count() == 1


class TestAquecimentoSoDosRecentes:
    def _config(self, db_session, **campos):
        linha = db_session.query(AppSettings).filter(AppSettings.id == 1).first() or AppSettings(id=1)
        for chave, valor in campos.items():
            setattr(linha, chave, valor)
        db_session.add(linha)
        db_session.commit()

    def test_por_padrao_aquece_todos(self, client, db_session):
        _, _, (a, b) = _setup(client, ["ds-1", "ds-2"])
        report_stats.record_open(db_session, a["id"])
        chamados = []
        with patch.object(embed_router, "warm_report", side_effect=lambda c, w, r, t: chamados.append(r.id) or False), patch.object(
            embed_router, "warm_dataset_refresh_info"
        ):
            _warm(db_session)

        assert sorted(chamados) == sorted([a["id"], b["id"]])

    def test_ligado_aquece_so_o_que_foi_aberto_nas_ultimas_horas(self, client, db_session):
        _, _, (a, b) = _setup(client, ["ds-1", "ds-2"])
        self._config(db_session, cache_warmup_only_recent=True, cache_warmup_recent_hours=24)
        report_stats.record_open(db_session, a["id"])
        report_stats.record_open(db_session, b["id"], datetime.now(timezone.utc) - timedelta(hours=60))
        chamados = []
        with patch.object(embed_router, "warm_report", side_effect=lambda c, w, r, t: chamados.append(r.id) or False), patch.object(
            embed_router, "warm_dataset_refresh_info"
        ):
            estatisticas = _warm(db_session)

        assert chamados == [a["id"]] and estatisticas["relatorios"] == 1

    def test_as_chaves_novas_das_configuracoes_vem_desligadas(self, client):
        admin = _headers_de(client, "admin@example.com")

        dados = client.get("/settings/", headers=admin).json()

        assert dados["embed_preload_enabled"] is True  # a pre-carga ja rodava: so desliga quem escolhe
        assert dados["cache_warmup_only_recent"] is False
        assert dados["capacity_control_enabled"] is False
        assert dados["cache_warmup_recent_hours"] == 72

    def test_so_quem_tem_o_item_de_cache_muda_as_chaves(self, client):
        admin = _headers_de(client, "admin@example.com")
        pessoa = _headers_de(client, "pessoa@example.com")

        assert client.put("/settings/", json={"embed_preload_enabled": False}, headers=pessoa).status_code == 403
        assert client.put("/settings/", json={"embed_preload_enabled": False}, headers=admin).json()["embed_preload_enabled"] is False


def _conta(db_session, **campos):
    conta = PowerBIConnection(name="Conta Ficticia", tenant_id="tenant-x", client_id="cliente-x", client_secret="segredo-x", **campos)
    db_session.add(conta)
    db_session.commit()
    return conta


def _ligar_chave(db_session):
    linha = db_session.query(AppSettings).filter(AppSettings.id == 1).first() or AppSettings(id=1)
    linha.capacity_control_enabled = True
    db_session.add(linha)
    db_session.commit()


AZURE = {"azure_subscription_id": "sub-1", "azure_resource_group": "grupo-1", "azure_capacity_name": "capacidade-1"}


class TestCapacidadeSimuladaEBloqueada:
    def test_tudo_desligado_por_padrao_e_o_botao_recusa(self, client, db_session):
        admin = _headers_de(client, "admin@example.com")
        conta = _conta(db_session, **AZURE)

        resposta = client.post(f"/cache-capacity/connections/{conta.id}/suspend", headers=admin)

        assert resposta.status_code == 409 and "desligado" in resposta.json()["detail"]
        assert conta.capacity_state is None

    def test_com_a_chave_geral_mas_sem_os_campos_do_azure_recusa(self, client, db_session):
        admin = _headers_de(client, "admin@example.com")
        _ligar_chave(db_session)
        conta = _conta(db_session)

        resposta = client.post(f"/cache-capacity/connections/{conta.id}/suspend", headers=admin)

        assert resposta.status_code == 409 and "Preencha" in resposta.json()["detail"]

    def test_por_padrao_e_simulado_so_registra_e_nunca_usa_a_rede(self, client, db_session):
        admin = _headers_de(client, "admin@example.com")
        _ligar_chave(db_session)
        conta = _conta(db_session, **AZURE)
        with patch("app.core.azure_capacity.httpx.Client", side_effect=AssertionError("rede usada")):
            pausada = client.post(f"/cache-capacity/connections/{conta.id}/suspend", headers=admin)
            retomada = client.post(f"/cache-capacity/connections/{conta.id}/resume", headers=admin)

        assert pausada.status_code == 200 and pausada.json()["mode"] == "simulated" and pausada.json()["state"] == "paused"
        assert retomada.json()["state"] == "running"
        acoes = [a.action for a in db_session.query(AuditLog).filter(AuditLog.action.like("capacity_%"))]
        assert acoes == ["capacity_suspend", "capacity_resume"]

    def test_acao_desconhecida_e_so_o_item_de_cache_mexe(self, client, db_session):
        admin = _headers_de(client, "admin@example.com")
        pessoa = _headers_de(client, "pessoa@example.com")
        conta = _conta(db_session, **AZURE)

        assert client.post(f"/cache-capacity/connections/{conta.id}/explodir", headers=admin).status_code == 404
        assert client.post(f"/cache-capacity/connections/{conta.id}/suspend", headers=pessoa).status_code == 403
        assert client.get("/cache-capacity/connections", headers=pessoa).status_code == 403
        assert client.get("/cache-capacity/connections").status_code == 401

    def test_a_chamada_real_sem_cliente_simulado_e_bloqueada_nos_testes(self, db_session):
        _ligar_chave(db_session)
        conta = _conta(db_session, capacity_real_calls=True, **AZURE)

        with pytest.raises(azure_capacity.CapacityError, match="bloqueada"):
            azure_capacity.run_action(db_session, conta, "suspend")

        assert conta.capacity_state is None

    def test_o_modo_real_monta_o_endereco_certo_com_um_cliente_simulado(self, db_session):
        _ligar_chave(db_session)
        conta = _conta(db_session, capacity_real_calls=True, **AZURE)
        pedidos = []

        def responder(request: httpx.Request) -> httpx.Response:
            pedidos.append((request.method, str(request.url)))
            if "login.microsoftonline.com" in str(request.url):
                assert b"management.azure.com" in request.content
                return httpx.Response(200, json={"access_token": "tok-falso"})
            assert request.headers["Authorization"] == "Bearer tok-falso"
            return httpx.Response(202)

        cliente = httpx.Client(transport=httpx.MockTransport(responder))
        resultado = azure_capacity.run_action(db_session, conta, "resume", http_client=cliente)

        assert resultado["mode"] == "real" and conta.capacity_state == "running"
        assert pedidos[1] == (
            "POST",
            "https://management.azure.com/subscriptions/sub-1/resourceGroups/grupo-1/providers/Microsoft.PowerBIDedicated/capacities/capacidade-1/resume?api-version=2021-01-01",
        )

    def test_erro_do_azure_nao_muda_o_estado(self, db_session):
        _ligar_chave(db_session)
        conta = _conta(db_session, capacity_real_calls=True, capacity_state="running", **AZURE)
        cliente = httpx.Client(
            transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"access_token": "t"}) if "login" in str(r.url) else httpx.Response(403))
        )

        with pytest.raises(azure_capacity.CapacityError, match="403"):
            azure_capacity.run_action(db_session, conta, "suspend", http_client=cliente)

        assert conta.capacity_state == "running"


class TestAgendaDaCapacidade:
    def _conta_com_agenda(self, db_session, faixas):
        return _conta(
            db_session, capacity_schedule_enabled=True, capacity_schedule_json=json.dumps(faixas), **AZURE
        )

    def test_dentro_da_faixa_retoma_e_fora_pausa_so_quando_o_estado_muda(self, db_session):
        _ligar_chave(db_session)
        conta = self._conta_com_agenda(db_session, [{"days": [0, 1, 2, 3, 4], "start": "08:00", "end": "18:00"}])
        quarta_12h = datetime(2026, 11, 25, 15, 0, tzinfo=timezone.utc)  # 12:00 em Sao Paulo
        quarta_20h = datetime(2026, 11, 25, 23, 0, tzinfo=timezone.utc)

        assert [a["action"] for a in azure_capacity.tick(db_session, quarta_12h)] == ["resume"]
        assert azure_capacity.tick(db_session, quarta_12h) == []  # ja esta ligada: nada a fazer
        assert [a["action"] for a in azure_capacity.tick(db_session, quarta_20h)] == ["suspend"]
        assert conta.capacity_state == "paused"

    def test_sem_a_chave_geral_ou_com_a_agenda_desligada_nada_acontece(self, db_session):
        conta = self._conta_com_agenda(db_session, SEMPRE_ABERTO)
        assert azure_capacity.tick(db_session) == []  # chave geral desligada

        _ligar_chave(db_session)
        conta.capacity_schedule_enabled = False
        db_session.commit()
        assert azure_capacity.tick(db_session) == []

    def test_conta_sem_os_campos_do_azure_e_ignorada(self, db_session):
        _ligar_chave(db_session)
        _conta(db_session, capacity_schedule_enabled=True, capacity_schedule_json=json.dumps(SEMPRE_ABERTO))

        assert azure_capacity.tick(db_session) == []

    def test_a_rotina_roda_uma_vez_sem_erro(self, db_session):
        from app.core import capacity_runner

        with patch("app.core.database.SessionLocal", return_value=db_session):
            assert capacity_runner.run_once() == []

    def test_salvar_a_configuracao_valida_a_agenda_e_nao_liga_nada(self, client, db_session):
        admin = _headers_de(client, "admin@example.com")
        conta = _conta(db_session)
        corpo = {**AZURE, "capacity_schedule_enabled": True, "schedule": [{"days": [0, 1], "start": "08:00", "end": "18:00"}]}

        salvo = client.put(f"/cache-capacity/connections/{conta.id}", json=corpo, headers=admin)
        ruim = client.put(f"/cache-capacity/connections/{conta.id}", json={**corpo, "schedule": [{"days": [], "start": "08:00", "end": "18:00"}]}, headers=admin)

        assert salvo.status_code == 200 and salvo.json()["simulated"] is True and salvo.json()["state"] is None
        assert salvo.json()["schedule"] == [{"days": [0, 1], "start": "08:00", "end": "18:00"}]
        assert ruim.status_code == 400
        assert azure_capacity.tick(db_session) == []  # chave geral ainda desligada

    def test_listar_traz_a_chave_geral_e_o_estado_de_cada_conta(self, client, db_session):
        admin = _headers_de(client, "admin@example.com")
        _conta(db_session, **AZURE)

        dados = client.get("/cache-capacity/connections", headers=admin).json()

        assert dados["master_switch"] is False
        assert dados["connections"][0]["configured"] is True and dados["connections"][0]["simulated"] is True
        assert "client_secret" not in json.dumps(dados)

"""Motor das assinaturas: quem esta vencido, o proximo horario avancar ANTES de enviar, horario perdido,
novas tentativas, pausa depois de falhas seguidas e conferencia das regras antes de cada envio.
Power BI, SMTP e o relogio sao simulados."""

import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core import powerbi, report_delivery, subscription_runner
from app.models.audit_log import AuditLog
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.settings import AppSettings
from app.models.subscription import ReportSubscription, SubscriptionRun
from app.models.workspace import Workspace
from app.routers import powerbi as embed_router

# Quarta-feira 08:00 em Sao Paulo
NOW = datetime(2026, 11, 4, 11, 0, tzinfo=timezone.utc)


def _limpa():
    embed_router._report_static_cache.clear()
    subscription_runner._in_flight.clear()
    report_delivery._jobs.clear()


@pytest.fixture(autouse=True)
def limpa_estado():
    _limpa()
    yield
    _limpa()


def montar(db, make_user, **extra):
    """Cria o necessario no banco e devolve (assinatura, relatorio, criador)."""
    opcoes = dict(
        enabled=True, next_run=NOW, days=list(range(7)), times=["08:00"], rls=False, domains="empresa.com",
        smtp=True, recipients=["gestor@empresa.com"], message=None, fmt="PDF", connection=True,
    )
    opcoes.update(extra)
    db.add(AppSettings(
        id=1, company_name="Empresa",
        smtp_host="smtp.x" if opcoes["smtp"] else None, smtp_from_email="relatorios@empresa.com",
        email_allowed_domains=opcoes["domains"],
    ))
    criador = make_user("criador@empresa.com", name="Fulano")
    ws = Workspace(name="Comercial", slug="comercial")
    conn = PowerBIConnection(name="C", tenant_id="t", client_id="c", client_secret="s")
    db.add_all([ws, conn])
    db.commit()
    relatorio = Report(
        collection_id=ws.id, name="Vendas", powerbi_connection_id=conn.id if opcoes["connection"] else None,
        pbi_workspace_id="pbi-ws", pbi_report_id="pbi-rel", pbi_dataset_id="ds-1",
    )
    relatorio.set_page_names(["Pagina1"])
    db.add(relatorio)
    db.commit()
    sub = ReportSubscription(
        report_id=relatorio.id, created_by_id=criador.id, created_by_name="Fulano", fmt=opcoes["fmt"],
        timezone="America/Sao_Paulo", enabled=opcoes["enabled"], next_run_at=opcoes["next_run"],
        message=opcoes["message"], consecutive_failures=0,
    )
    sub.recipients, sub.days, sub.times = opcoes["recipients"], opcoes["days"], opcoes["times"]
    db.add(sub)
    db.commit()
    return SimpleNamespace(sub=sub, report=relatorio, criador=criador, ws=ws)


class _SessaoCompartilhada:
    """O codigo abre e FECHA a propria sessao (certo em producao). O teste usa uma sessao so, e fechar
    soltaria os objetos que ele ainda vai ler: o close() aqui nao faz nada."""

    def __init__(self, db):
        self._db = db

    def close(self):
        pass

    def __getattr__(self, nome):
        return getattr(self._db, nome)


def fabrica(db):
    return lambda: _SessaoCompartilhada(db)


def pbi(rls=False):
    return (
        patch.object(powerbi, "get_report_details", return_value={"embedUrl": "https://embed/x"}),
        patch.object(powerbi, "dataset_requires_effective_identity", return_value=rls),
    )


def entrega(resultados):
    """Entrega de mentira: cada chamada usa o proximo resultado ("ok" ou o texto do erro)."""
    chamadas = []

    def deliver(**kw):
        chamadas.append(kw)
        resultado = resultados[min(len(chamadas) - 1, len(resultados) - 1)]
        job = kw["job"]
        if resultado == "ok":
            job.status, job.message = "done", "E-mail enviado."
        else:
            job.status, job.message = "error", resultado

    return deliver, chamadas


def rodar(db, sub, deliver, trigger="schedule", esperas=None, job=None, rls=False):
    p1, p2 = pbi(rls)
    with p1, p2, patch.object(subscription_runner, "send_email") as aviso:
        retorno = subscription_runner.run_subscription(
            sub.id, trigger, session_factory=fabrica(db), job=job, deliver=deliver,
            sleep=(esperas.append if esperas is not None else (lambda s: None)), now_fn=lambda: NOW,
        )
    return retorno, aviso


def recarregar(db, sub):
    db.expire_all()
    return db.get(ReportSubscription, sub.id)


class TestQuemVenceu:
    def test_nada_vencido_nada_acontece(self, db_session, make_user):
        m = montar(db_session, make_user, next_run=NOW + timedelta(hours=1))
        iniciar = MagicMock()

        contagem = subscription_runner.process_due(fabrica(db_session), NOW, iniciar)

        assert contagem == {"iniciadas": 0, "perdidas": 0, "em_andamento": 0}
        iniciar.assert_not_called()
        assert recarregar(db_session, m.sub).next_run_at is not None

    def test_vencida_dentro_da_tolerancia_e_iniciada(self, db_session, make_user):
        m = montar(db_session, make_user, next_run=NOW - timedelta(minutes=10))
        iniciar = MagicMock()

        contagem = subscription_runner.process_due(fabrica(db_session), NOW, iniciar)

        assert contagem["iniciadas"] == 1
        iniciar.assert_called_once_with(m.sub.id, "schedule")

    def test_o_proximo_horario_ja_esta_gravado_quando_o_envio_comeca(self, db_session, make_user):
        m = montar(db_session, make_user)
        visto = {}

        def iniciar(sub_id, trigger):
            db_session.expire_all()
            visto["proximo"] = db_session.get(ReportSubscription, sub_id).next_run_at

        subscription_runner.process_due(fabrica(db_session), NOW, iniciar)

        proximo = visto["proximo"].replace(tzinfo=timezone.utc)
        assert proximo == datetime(2026, 11, 5, 11, 0, tzinfo=timezone.utc)  # amanha 08:00, nao o mesmo horario

    def test_o_mesmo_horario_nao_dispara_duas_vezes(self, db_session, make_user):
        montar(db_session, make_user)
        iniciar = MagicMock()

        subscription_runner.process_due(fabrica(db_session), NOW, iniciar)
        subscription_runner.process_due(fabrica(db_session), NOW + timedelta(seconds=30), iniciar)
        subscription_runner.process_due(fabrica(db_session), NOW + timedelta(minutes=5), iniciar)

        assert iniciar.call_count == 1

    def test_horario_muito_atrasado_nao_e_enviado_e_fica_no_historico(self, db_session, make_user):
        m = montar(db_session, make_user, next_run=NOW - timedelta(hours=6))
        iniciar = MagicMock()

        contagem = subscription_runner.process_due(fabrica(db_session), NOW, iniciar)

        assert contagem["perdidas"] == 1 and contagem["iniciadas"] == 0
        iniciar.assert_not_called()
        sub = recarregar(db_session, m.sub)
        assert sub.last_status == "skipped" and "perdido" in sub.last_message
        assert sub.consecutive_failures == 0  # perder o horario nao e falha da assinatura
        run = db_session.query(SubscriptionRun).one()
        assert (run.status, run.attempts) == ("skipped", 0)

    def test_servidor_parado_por_dias_nao_gera_uma_fila_de_envios(self, db_session, make_user):
        m = montar(db_session, make_user, next_run=NOW - timedelta(days=3))
        iniciar = MagicMock()

        subscription_runner.process_due(fabrica(db_session), NOW, iniciar)

        iniciar.assert_not_called()
        assert db_session.query(SubscriptionRun).count() == 1  # um registro so, nao um por dia perdido
        proximo = recarregar(db_session, m.sub).next_run_at.replace(tzinfo=timezone.utc)
        assert proximo == datetime(2026, 11, 5, 11, 0, tzinfo=timezone.utc)

    def test_envio_anterior_ainda_em_andamento_pula_este_horario(self, db_session, make_user):
        m = montar(db_session, make_user)
        subscription_runner._in_flight.add(m.sub.id)
        iniciar = MagicMock()

        contagem = subscription_runner.process_due(fabrica(db_session), NOW, iniciar)

        assert contagem["em_andamento"] == 1
        iniciar.assert_not_called()
        assert "andamento" in db_session.query(SubscriptionRun).one().message

    def test_pausada_ou_sem_proximo_horario_nao_e_olhada(self, db_session, make_user):
        montar(db_session, make_user, enabled=False)
        iniciar = MagicMock()

        subscription_runner.process_due(fabrica(db_session), NOW, iniciar)

        iniciar.assert_not_called()

    def test_periodo_que_acabou_fica_sem_proximo_horario(self, db_session, make_user):
        m = montar(db_session, make_user)
        m.sub.end_date = NOW.date()  # hoje e o ultimo dia; o horario de hoje (08:00) e o ultimo
        db_session.commit()

        subscription_runner.process_due(fabrica(db_session), NOW, MagicMock())

        assert recarregar(db_session, m.sub).next_run_at is None

    def test_varias_assinaturas_vencidas_sao_todas_iniciadas(self, db_session, make_user):
        a = montar(db_session, make_user)
        outra = ReportSubscription(
            report_id=a.report.id, created_by_id=a.criador.id, created_by_name="Fulano", fmt="PDF",
            timezone="America/Sao_Paulo", enabled=True, next_run_at=NOW, consecutive_failures=0,
        )
        outra.recipients, outra.days, outra.times = ["x@empresa.com"], list(range(7)), ["08:00"]
        db_session.add(outra)
        db_session.commit()
        iniciar = MagicMock()

        contagem = subscription_runner.process_due(fabrica(db_session), NOW, iniciar)

        assert contagem["iniciadas"] == 2


class TestEnvio:
    def test_envia_com_tudo_o_que_a_entrega_precisa(self, db_session, make_user):
        m = montar(db_session, make_user, message="Segue o fechamento.", fmt="PNG")
        deliver, chamadas = entrega(["ok"])

        rodar(db_session, m.sub, deliver)

        kw = chamadas[0]
        assert (kw["fmt"], kw["recipients"], kw["report_name"]) == ("PNG", ["gestor@empresa.com"], "Vendas")
        assert (kw["pbi_workspace_id"], kw["pbi_report_id"], kw["page_names"]) == ("pbi-ws", "pbi-rel", ["Pagina1"])
        assert kw["subject"] == "Empresa - Vendas"
        assert "Segue o fechamento." in kw["body"]
        assert "Envio automatico programado por Fulano" in kw["body"]
        assert type(kw["connection"]).__name__ == "SimpleNamespace"
        assert kw["smtp"].host == "smtp.x"

    def test_assunto_personalizado_vale_no_lugar_do_padrao(self, db_session, make_user):
        m = montar(db_session, make_user)
        m.sub.subject = "Fechamento semanal"
        db_session.commit()
        deliver, chamadas = entrega(["ok"])

        rodar(db_session, m.sub, deliver)

        assert chamadas[0]["subject"] == "Fechamento semanal"

    def test_sucesso_grava_historico_estado_e_zera_as_falhas(self, db_session, make_user):
        m = montar(db_session, make_user)
        m.sub.consecutive_failures = 2
        db_session.commit()
        deliver, _ = entrega(["ok"])

        rodar(db_session, m.sub, deliver)

        sub = recarregar(db_session, m.sub)
        assert (sub.last_status, sub.consecutive_failures, sub.enabled) == ("ok", 0, True)
        assert sub.last_run_at is not None
        run = db_session.query(SubscriptionRun).one()
        assert (run.status, run.trigger, run.attempts, run.recipients_count) == ("ok", "schedule", 1, 1)

    def test_auditoria_so_tem_a_contagem_nunca_os_enderecos(self, db_session, make_user):
        m = montar(db_session, make_user, recipients=["gestor@empresa.com", "outro@empresa.com"])
        deliver, _ = entrega(["ok"])

        rodar(db_session, m.sub, deliver)

        log = db_session.query(AuditLog).filter(AuditLog.action == "subscription_sent").one()
        assert log.details == "PDF, 2 destinatario(s)"

    def test_nao_deixa_o_envio_em_andamento_marcado_depois_de_terminar(self, db_session, make_user):
        m = montar(db_session, make_user)
        deliver, _ = entrega(["ok"])

        rodar(db_session, m.sub, deliver)

        assert m.sub.id not in subscription_runner._in_flight


class TestNovasTentativas:
    def test_falha_duas_vezes_e_acerta_na_terceira(self, db_session, make_user):
        m = montar(db_session, make_user)
        deliver, chamadas = entrega(["Power BI ocupado", "Power BI ocupado", "ok"])
        esperas = []

        rodar(db_session, m.sub, deliver, esperas=esperas)

        assert len(chamadas) == 3
        assert esperas == [60, 180]  # espera crescente entre as tentativas
        sub = recarregar(db_session, m.sub)
        assert (sub.last_status, sub.consecutive_failures) == ("ok", 0)
        assert db_session.query(SubscriptionRun).one().attempts == 3

    def test_esgota_as_tentativas_e_registra_a_falha_sem_pausar_ainda(self, db_session, make_user):
        m = montar(db_session, make_user)
        deliver, chamadas = entrega(["capacidade sem suporte"])
        esperas = []

        rodar(db_session, m.sub, deliver, esperas=esperas)

        assert len(chamadas) == 3 and esperas == [60, 180]
        sub = recarregar(db_session, m.sub)
        assert (sub.last_status, sub.last_message, sub.consecutive_failures, sub.enabled) == (
            "error", "capacidade sem suporte", 1, True,
        )
        run = db_session.query(SubscriptionRun).one()
        assert (run.status, run.attempts) == ("error", 3)

    def test_a_terceira_falha_seguida_pausa_a_assinatura_e_avisa_quem_criou(self, db_session, make_user):
        m = montar(db_session, make_user)
        deliver, _ = entrega(["capacidade sem suporte"])

        for _ in range(2):
            rodar(db_session, m.sub, deliver)
        assert recarregar(db_session, m.sub).enabled is True  # duas falhas ainda nao pausam
        _, aviso = rodar(db_session, m.sub, deliver)

        sub = recarregar(db_session, m.sub)
        assert (sub.enabled, sub.next_run_at, sub.consecutive_failures) == (False, None, 3)
        assert db_session.query(AuditLog).filter(AuditLog.action == "subscription_paused").count() == 1
        aviso.assert_called_once()
        _, destinatarios, assunto, corpo = aviso.call_args.args
        assert destinatarios == ["criador@empresa.com"]
        assert "Vendas" in assunto and "capacidade sem suporte" in corpo

    def test_um_sucesso_no_meio_zera_a_contagem(self, db_session, make_user):
        m = montar(db_session, make_user)
        falha, _ = entrega(["x"])
        ok, _ = entrega(["ok"])

        rodar(db_session, m.sub, falha)
        rodar(db_session, m.sub, falha)
        rodar(db_session, m.sub, ok)
        rodar(db_session, m.sub, falha)

        sub = recarregar(db_session, m.sub)
        assert (sub.consecutive_failures, sub.enabled) == (1, True)

    def test_falha_ao_avisar_o_criador_nao_estraga_a_pausa(self, db_session, make_user):
        m = montar(db_session, make_user)
        m.sub.consecutive_failures = 2
        db_session.commit()
        deliver, _ = entrega(["x"])
        p1, p2 = pbi()

        with p1, p2, patch.object(subscription_runner, "send_email", side_effect=RuntimeError("smtp caiu")):
            retorno = subscription_runner.run_subscription(
                m.sub.id, "schedule", session_factory=fabrica(db_session), deliver=deliver,
                sleep=lambda s: None, now_fn=lambda: NOW,
            )

        assert retorno is True and recarregar(db_session, m.sub).enabled is False


class TestEnvioManual:
    def test_so_uma_tentativa_e_usa_o_trabalho_recebido(self, db_session, make_user):
        m = montar(db_session, make_user)
        job = report_delivery.create_job(user_id=1)
        deliver, chamadas = entrega(["falhou na hora"])
        esperas = []

        rodar(db_session, m.sub, deliver, trigger="manual", esperas=esperas, job=job)

        assert len(chamadas) == 1 and esperas == []
        assert (job.status, job.message) == ("error", "falhou na hora")
        assert chamadas[0]["job"] is job
        assert db_session.query(SubscriptionRun).one().trigger == "manual"

    def test_falha_manual_nao_conta_para_pausar_nem_mexe_na_agenda(self, db_session, make_user):
        m = montar(db_session, make_user, next_run=NOW + timedelta(days=1))
        deliver, _ = entrega(["x"])

        for _ in range(5):
            rodar(db_session, m.sub, deliver, trigger="manual", job=report_delivery.create_job(1))

        sub = recarregar(db_session, m.sub)
        assert (sub.consecutive_failures, sub.enabled) == (0, True)
        assert sub.next_run_at.replace(tzinfo=timezone.utc) == NOW + timedelta(days=1)
        assert sub.last_status == "error"

    def test_sucesso_manual_aparece_no_estado_sem_zerar_nada_da_agenda(self, db_session, make_user):
        m = montar(db_session, make_user, next_run=NOW + timedelta(days=1))
        deliver, _ = entrega(["ok"])

        rodar(db_session, m.sub, deliver, trigger="manual", job=report_delivery.create_job(1))

        sub = recarregar(db_session, m.sub)
        assert sub.last_status == "ok" and sub.next_run_at.replace(tzinfo=timezone.utc) == NOW + timedelta(days=1)


class TestConferenciaAntesDeCadaEnvio:
    def test_relatorio_que_ganhou_rls_pausa_na_hora_e_nao_envia(self, db_session, make_user):
        m = montar(db_session, make_user)
        deliver, chamadas = entrega(["ok"])

        rodar(db_session, m.sub, deliver, rls=True)

        assert chamadas == []
        sub = recarregar(db_session, m.sub)
        assert (sub.enabled, sub.next_run_at, sub.last_status) == (False, None, "error")
        assert "RLS" in sub.last_message
        assert db_session.query(AuditLog).filter(AuditLog.action == "subscription_paused").count() == 1

    def test_dominio_que_deixou_de_ser_permitido_pausa_na_hora_e_nao_envia(self, db_session, make_user):
        m = montar(db_session, make_user, domains="outra.com")
        deliver, chamadas = entrega(["ok"])

        rodar(db_session, m.sub, deliver)

        assert chamadas == []
        sub = recarregar(db_session, m.sub)
        assert sub.enabled is False and "dominios permitidos" in sub.last_message

    def test_relatorio_sem_conta_do_power_bi_pausa_na_hora(self, db_session, make_user):
        m = montar(db_session, make_user, connection=False)
        deliver, chamadas = entrega(["ok"])

        rodar(db_session, m.sub, deliver)

        assert chamadas == [] and recarregar(db_session, m.sub).enabled is False

    def test_email_nao_configurado_falha_mas_nao_pausa_de_cara(self, db_session, make_user):
        m = montar(db_session, make_user, smtp=False)
        deliver, chamadas = entrega(["ok"])

        rodar(db_session, m.sub, deliver)

        assert chamadas == []
        sub = recarregar(db_session, m.sub)
        assert sub.enabled is True and sub.consecutive_failures == 1 and "nao esta configurado" in sub.last_message

    def test_power_bi_indisponivel_na_conferencia_conta_como_falha_comum(self, db_session, make_user):
        m = montar(db_session, make_user)
        deliver, chamadas = entrega(["ok"])

        with patch.object(powerbi, "get_report_details", side_effect=powerbi.PowerBIError("fora do ar")), patch.object(
            powerbi, "dataset_requires_effective_identity", return_value=False
        ), patch.object(subscription_runner, "send_email"):
            subscription_runner.run_subscription(
                m.sub.id, "schedule", session_factory=fabrica(db_session), deliver=deliver, sleep=lambda s: None, now_fn=lambda: NOW
            )

        assert chamadas == []
        sub = recarregar(db_session, m.sub)
        assert sub.enabled is True and "fora do ar" in sub.last_message

    def test_o_estado_do_rls_nunca_vem_do_cache(self, db_session, make_user):
        m = montar(db_session, make_user)
        embed_router._report_static_cache[(m.ws.id, m.report.id)] = (
            NOW + timedelta(days=1), {"embed_url": "x", "needs_identity": False},
        )
        deliver, chamadas = entrega(["ok"])

        rodar(db_session, m.sub, deliver, rls=True)  # o Power BI agora diz que tem RLS; o cache ainda diz que nao

        assert chamadas == []


class TestRobustez:
    def test_nao_envia_duas_vezes_ao_mesmo_tempo(self, db_session, make_user):
        m = montar(db_session, make_user)
        subscription_runner._in_flight.add(m.sub.id)
        deliver, chamadas = entrega(["ok"])

        retorno, _ = rodar(db_session, m.sub, deliver)

        assert retorno is False and chamadas == []

    def test_assinatura_inexistente_nao_levanta(self, db_session, make_user):
        montar(db_session, make_user)
        deliver, chamadas = entrega(["ok"])

        retorno = subscription_runner.run_subscription(
            9999, "schedule", session_factory=fabrica(db_session), deliver=deliver, now_fn=lambda: NOW
        )

        assert retorno is True and chamadas == []

    def test_erro_inesperado_na_entrega_nao_derruba_e_libera_o_trabalho(self, db_session, make_user):
        m = montar(db_session, make_user)
        job = report_delivery.create_job(1)

        def quebra(**kw):
            raise RuntimeError("detalhe interno secreto")

        retorno, _ = rodar(db_session, m.sub, quebra, trigger="manual", job=job)

        assert retorno is True
        assert job.status == "error" and "secreto" not in job.message
        assert m.sub.id not in subscription_runner._in_flight

    def test_assinatura_apagada_no_meio_do_envio_nao_estoura(self, db_session, make_user):
        m = montar(db_session, make_user)

        def apaga_e_conclui(**kw):
            db_session.delete(db_session.get(ReportSubscription, m.sub.id))
            db_session.commit()
            kw["job"].status, kw["job"].message = "done", "E-mail enviado."

        retorno, _ = rodar(db_session, m.sub, apaga_e_conclui)

        assert retorno is True and db_session.query(SubscriptionRun).count() == 0

    def test_is_running_acompanha_o_envio(self, db_session, make_user):
        m = montar(db_session, make_user)
        durante = []

        def olha(**kw):
            durante.append(subscription_runner.is_running(m.sub.id))
            kw["job"].status, kw["job"].message = "done", "E-mail enviado."

        rodar(db_session, m.sub, olha)

        assert durante == [True] and subscription_runner.is_running(m.sub.id) is False


class TestAgendador:
    def setup_method(self):
        subscription_runner._thread = None
        subscription_runner._stop.clear()

    def teardown_method(self):
        subscription_runner.stop()
        if subscription_runner._thread is not None:
            subscription_runner._thread.join(timeout=3)
        subscription_runner._thread = None

    def test_nao_inicia_quando_esta_desligado(self):
        with patch.object(subscription_runner.settings, "subscriptions_enabled", False):
            subscription_runner.start()

        assert subscription_runner._thread is None

    def test_inicia_roda_um_ciclo_e_para_quando_pedido(self):
        ciclo = MagicMock(return_value={})
        with patch.object(subscription_runner, "process_due", ciclo), patch.object(
            subscription_runner.settings, "subscriptions_enabled", True
        ):
            subscription_runner.start()
            espera = time.monotonic() + 3
            while ciclo.call_count == 0 and time.monotonic() < espera:
                time.sleep(0.02)
            thread = subscription_runner._thread
            subscription_runner.stop()
            thread.join(timeout=3)

        assert ciclo.call_count == 1 and not thread.is_alive()

    def test_um_ciclo_que_levanta_excecao_nao_derruba_o_agendador(self):
        ciclo = MagicMock(side_effect=RuntimeError("banco caiu"))
        with patch.object(subscription_runner, "process_due", ciclo), patch.object(
            subscription_runner.settings, "subscriptions_enabled", True
        ):
            subscription_runner.start()
            espera = time.monotonic() + 3
            while ciclo.call_count == 0 and time.monotonic() < espera:
                time.sleep(0.02)
            assert subscription_runner._thread.is_alive()
            subscription_runner.stop()

    def test_nao_inicia_duas_instancias(self):
        with patch.object(subscription_runner, "process_due", MagicMock(return_value={})), patch.object(
            subscription_runner.settings, "subscriptions_enabled", True
        ):
            subscription_runner.start()
            primeira = subscription_runner._thread
            subscription_runner.start()

            assert subscription_runner._thread is primeira

    def test_a_aplicacao_liga_e_desliga_o_agendador_no_lifespan(self):
        from app.main import app

        with patch.object(subscription_runner, "start") as liga, patch.object(subscription_runner, "stop") as desliga:
            with TestClient(app):
                liga.assert_called_once()
                desliga.assert_not_called()
            desliga.assert_called_once()

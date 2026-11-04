"""Entrega de relatorio por e-mail em segundo plano: o acompanhamento do trabalho, o que a thread
faz (exportar, enviar) e as rotas. Power BI e SMTP sao sempre simulados."""

import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.core import powerbi, report_delivery
from app.core.email_sender import Attachment, EmailError, SmtpConfig
from app.models.audit_log import AuditLog

PASSWORD = "SenhaForte123"
SMTP = SmtpConfig("smtp.x", 587, "starttls", "u", "p", "relatorios@exemplo.com", "BIHoster")
CONEXAO = SimpleNamespace(id=1, tenant_id="t", client_id="c", client_secret="s")


def _entrega(job, **extra):
    base = dict(
        job=job, connection=CONEXAO, pbi_workspace_id="ws", pbi_report_id="rel", page_names=[], fmt="PDF",
        report_name="Vendas", smtp=SMTP, recipients=["a@x.com"], subject="Assunto", body="Corpo",
    )
    base.update(extra)
    return base


@pytest.fixture(autouse=True)
def limpa_trabalhos():
    report_delivery._jobs.clear()
    yield
    report_delivery._jobs.clear()


class TestTrabalhos:
    def test_so_quem_criou_ve_o_trabalho(self):
        job = report_delivery.create_job(user_id=7)

        assert report_delivery.get_job(job.id, 7) is job
        assert report_delivery.get_job(job.id, 8) is None
        assert report_delivery.get_job("inexistente", 7) is None

    def test_trabalhos_antigos_e_terminados_saem_da_memoria(self):
        velho = report_delivery.create_job(1)
        velho.status = "done"
        velho.created_at = time.monotonic() - report_delivery._JOB_TTL_SECONDS - 1
        em_andamento = report_delivery.create_job(1)
        em_andamento.created_at = time.monotonic() - report_delivery._JOB_TTL_SECONDS - 1

        report_delivery.create_job(1)  # criar um novo dispara a limpeza

        assert velho.id not in report_delivery._jobs
        assert em_andamento.id in report_delivery._jobs  # o que ainda roda nunca e descartado

    def test_teto_de_trabalhos_descarta_os_terminados_mais_antigos(self):
        with patch.object(report_delivery, "_MAX_JOBS", 3):
            primeiros = [report_delivery.create_job(1) for _ in range(3)]
            for j in primeiros:
                j.status = "done"
            report_delivery.create_job(1)

        assert len(report_delivery._jobs) == 3
        assert primeiros[0].id not in report_delivery._jobs

    @pytest.mark.parametrize(
        "nome, esperado",
        [
            ("Vendas Mensal", "Vendas Mensal.pdf"),
            ("../../etc/passwd", "etcpasswd.pdf"),
            ('Relatorio "final"\r\nBcc: x', "Relatorio final Bcc x.pdf"),
            ("", "relatorio.pdf"),
            ("///", "relatorio.pdf"),
            ("Inclusões e Vendas", "Inclusões e Vendas.pdf"),
            ("x" * 200, "x" * 80 + ".pdf"),
        ],
    )
    def test_nome_do_arquivo_e_limpo(self, nome, esperado):
        assert report_delivery.safe_filename(nome, ".pdf") == esperado


class TestRunDelivery:
    def test_exporta_e_envia_o_arquivo_anexado(self):
        job = report_delivery.create_job(1)
        with patch.object(powerbi, "export_report", return_value=b"%PDF-dados") as exportar, patch.object(
            report_delivery, "send_email"
        ) as enviar:
            report_delivery.run_delivery(**_entrega(job, page_names=["P1"]))

        assert (job.status, job.message, job.progress) == ("done", "E-mail enviado.", 100)
        assert exportar.call_args.args[:4] == (CONEXAO, "ws", "rel", "PDF")
        assert exportar.call_args.args[4] == ["P1"]
        smtp, destinatarios, assunto, corpo, anexos = enviar.call_args.args
        assert (smtp, destinatarios, assunto, corpo) == (SMTP, ["a@x.com"], "Assunto", "Corpo")
        assert anexos == [Attachment("Vendas.pdf", b"%PDF-dados", "application/pdf")]

    def test_sem_abas_escolhidas_exporta_o_relatorio_inteiro(self):
        job = report_delivery.create_job(1)
        with patch.object(powerbi, "export_report", return_value=b"x") as exportar, patch.object(report_delivery, "send_email"):
            report_delivery.run_delivery(**_entrega(job))

        assert exportar.call_args.args[4] is None

    def test_o_progresso_da_exportacao_aparece_no_trabalho(self):
        job = report_delivery.create_job(1)

        def exportar(*args, on_progress=None, **kwargs):
            on_progress(42)
            assert (job.status, job.progress) == ("exporting", 42)
            return b"x"

        with patch.object(powerbi, "export_report", side_effect=exportar), patch.object(report_delivery, "send_email"):
            report_delivery.run_delivery(**_entrega(job))

        assert job.status == "done"

    def test_falha_do_power_bi_nao_envia_nada_e_o_trabalho_mostra_o_motivo(self):
        job = report_delivery.create_job(1)
        with patch.object(powerbi, "export_report", side_effect=powerbi.PowerBIError("capacidade sem suporte")), patch.object(
            report_delivery, "send_email"
        ) as enviar:
            report_delivery.run_delivery(**_entrega(job))

        assert (job.status, job.message) == ("error", "capacidade sem suporte")
        enviar.assert_not_called()

    def test_falha_do_smtp_e_registrada_no_trabalho(self):
        job = report_delivery.create_job(1)
        with patch.object(powerbi, "export_report", return_value=b"x"), patch.object(
            report_delivery, "send_email", side_effect=EmailError("O servidor recusou o usuario ou a senha do SMTP.")
        ):
            report_delivery.run_delivery(**_entrega(job))

        assert job.status == "error" and "usuario ou a senha" in job.message

    def test_erro_inesperado_nao_derruba_a_thread_e_nao_vaza_detalhe(self):
        job = report_delivery.create_job(1)
        with patch.object(powerbi, "export_report", side_effect=RuntimeError("detalhe interno secreto")):
            report_delivery.run_delivery(**_entrega(job))

        assert job.status == "error"
        assert "secreto" not in job.message

    def test_avisa_o_resultado_para_quem_pediu_registrar(self):
        job = report_delivery.create_job(1)
        resultado = MagicMock()
        with patch.object(powerbi, "export_report", return_value=b"x"), patch.object(report_delivery, "send_email"):
            report_delivery.run_delivery(**_entrega(job, on_finish=resultado))
        resultado.assert_called_once_with(True, "E-mail enviado.")

        resultado.reset_mock()
        with patch.object(powerbi, "export_report", side_effect=powerbi.PowerBIError("x")):
            report_delivery.run_delivery(**_entrega(job, on_finish=resultado))
        resultado.assert_called_once_with(False, "x")

    def test_falha_ao_registrar_o_resultado_nao_estraga_o_envio(self):
        job = report_delivery.create_job(1)
        with patch.object(powerbi, "export_report", return_value=b"x"), patch.object(report_delivery, "send_email"):
            report_delivery.run_delivery(**_entrega(job, on_finish=MagicMock(side_effect=RuntimeError("banco caiu"))))

        assert job.status == "done"

    def test_no_maximo_duas_exportacoes_ao_mesmo_tempo(self):
        simultaneas, pico = [0], [0]
        lock = __import__("threading").Lock()

        def exportar(*args, **kwargs):
            with lock:
                simultaneas[0] += 1
                pico[0] = max(pico[0], simultaneas[0])
            time.sleep(0.1)
            with lock:
                simultaneas[0] -= 1
            return b"x"

        jobs = [report_delivery.create_job(1) for _ in range(5)]
        with patch.object(powerbi, "export_report", side_effect=exportar), patch.object(report_delivery, "send_email"):
            threads = [report_delivery.start_in_background(**_entrega(j)) for j in jobs]
            for t in threads:
                t.join(timeout=10)

        assert pico[0] == 2
        assert all(j.status == "done" for j in jobs)


def _headers(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def cenario(client):
    admin = _headers(client, "admin@example.com")
    client.put(
        "/settings/email/",
        json={"smtp_host": "smtp.x", "smtp_from_email": "relatorios@exemplo.com", "smtp_security": "starttls"},
        headers=admin,
    )
    ws = client.post("/workspaces/", json={"name": "Comercial"}, headers=admin).json()
    conn = client.post(
        "/powerbi-connections/", json={"name": "C", "tenant_id": "t", "client_id": "c", "client_secret": "s"}, headers=admin
    ).json()
    rel = client.post(
        f"/workspaces/{ws['id']}/reports/",
        json={"name": "Vendas", "powerbi_connection_id": conn["id"], "pbi_workspace_id": "pbi-ws", "pbi_report_id": "pbi-rel", "pbi_dataset_id": "ds-1"},
        headers=admin,
    ).json()
    return SimpleNamespace(admin=admin, ws=ws, rel=rel)


def _url(c):
    return f"/workspaces/{c.ws['id']}/powerbi/reports/{c.rel['id']}/export-email"


def _pbi(rls=False):
    return (
        patch.object(powerbi, "get_report_details", return_value={"embedUrl": "https://embed/x"}),
        patch.object(powerbi, "dataset_requires_effective_identity", return_value=rls),
    )


class TestRotaExportarEEnviar:
    def test_pede_o_trabalho_e_a_thread_recebe_tudo_o_que_precisa(self, client, cenario):
        p1, p2 = _pbi()
        with p1, p2, patch("app.routers.report_export.report_delivery.start_in_background") as iniciar:
            resp = client.post(_url(cenario), json={"to": "alvo@exemplo.com", "format": "PDF"}, headers=cenario.admin)

        assert resp.status_code == 202
        kw = iniciar.call_args.kwargs
        assert kw["job"].id == resp.json()["job_id"]
        assert (kw["pbi_workspace_id"], kw["pbi_report_id"], kw["fmt"]) == ("pbi-ws", "pbi-rel", "PDF")
        assert kw["recipients"] == ["alvo@exemplo.com"] and kw["report_name"] == "Vendas"
        assert (kw["smtp"].host, kw["smtp"].from_email) == ("smtp.x", "relatorios@exemplo.com")
        # A thread recebe uma copia simples da conta, nao o objeto ligado a sessao do banco
        assert type(kw["connection"]).__name__ == "SimpleNamespace"

    def test_a_auditoria_guarda_so_a_contagem_nunca_o_endereco(self, client, cenario, db_session):
        p1, p2 = _pbi()
        with p1, p2, patch("app.routers.report_export.report_delivery.start_in_background"):
            client.post(_url(cenario), json={"to": "alvo@exemplo.com"}, headers=cenario.admin)

        log = db_session.query(AuditLog).filter(AuditLog.action == "export_email_requested").one()
        assert log.details == "PDF, 1 destinatario"
        assert "alvo@exemplo.com" not in log.details

    def test_o_resultado_tambem_vai_para_a_auditoria(self, client, cenario, db_session):
        p1, p2 = _pbi()
        with p1, p2, patch("app.routers.report_export.report_delivery.start_in_background") as iniciar:
            client.post(_url(cenario), json={"to": "alvo@exemplo.com"}, headers=cenario.admin)

        with patch("app.routers.report_export.SessionLocal", lambda: db_session):
            iniciar.call_args.kwargs["on_finish"](True, "E-mail enviado.")
            iniciar.call_args.kwargs["on_finish"](False, "capacidade sem suporte")

        acoes = {l.action: l.details for l in db_session.query(AuditLog).filter(AuditLog.action.like("export_email_%"))}
        assert acoes["export_email_sent"] == "PDF, 1 destinatario"
        assert acoes["export_email_failed"] == "PDF: capacidade sem suporte"

    def test_relatorio_com_rls_e_recusado(self, client, cenario):
        p1, p2 = _pbi(rls=True)
        with p1, p2, patch("app.routers.report_export.report_delivery.start_in_background") as iniciar:
            resp = client.post(_url(cenario), json={"to": "a@x.com"}, headers=cenario.admin)

        assert resp.status_code == 400 and "RLS" in resp.json()["detail"]
        iniciar.assert_not_called()

    def test_sem_e_mail_configurado_pede_para_configurar(self, client, cenario, db_session):
        client.put("/settings/email/", json={"smtp_host": ""}, headers=cenario.admin)

        with patch("app.routers.report_export.report_delivery.start_in_background") as iniciar:
            resp = client.post(_url(cenario), json={"to": "a@x.com"}, headers=cenario.admin)

        assert resp.status_code == 400 and "Configure" in resp.json()["detail"]
        iniciar.assert_not_called()

    def test_destinatario_fora_dos_dominios_permitidos(self, client, cenario):
        client.put("/settings/email/", json={"email_allowed_domains": "empresa.com"}, headers=cenario.admin)

        with patch("app.routers.report_export.report_delivery.start_in_background") as iniciar:
            resp = client.post(_url(cenario), json={"to": "x@gmail.com"}, headers=cenario.admin)

        assert resp.status_code == 400
        iniciar.assert_not_called()

    def test_so_administrador_pode(self, client, cenario):
        pessoa = _headers(client, "pessoa@example.com")

        resp = client.post(_url(cenario), json={"to": "a@x.com"}, headers=pessoa)

        assert resp.status_code == 403
        assert client.post(_url(cenario), json={"to": "a@x.com"}).status_code == 401

    def test_relatorio_de_outra_colecao_ou_inexistente_da_404(self, client, cenario):
        resp = client.post(
            f"/workspaces/{cenario.ws['id']}/powerbi/reports/9999/export-email", json={"to": "a@x.com"}, headers=cenario.admin
        )

        assert resp.status_code == 404

    def test_formato_desconhecido_e_endereco_invalido(self, client, cenario):
        assert client.post(_url(cenario), json={"to": "a@x.com", "format": "DOCX"}, headers=cenario.admin).status_code == 422
        assert client.post(_url(cenario), json={"to": "nao-e-email"}, headers=cenario.admin).status_code == 422

    def test_limite_de_pedidos_por_minuto(self, client, cenario):
        p1, p2 = _pbi()
        with p1, p2, patch("app.routers.report_export.report_delivery.start_in_background"):
            codigos = [client.post(_url(cenario), json={"to": "a@x.com"}, headers=cenario.admin).status_code for _ in range(4)]

        assert codigos == [202, 202, 202, 429]


class TestRotaDoAcompanhamento:
    def _url(self, c, job_id):
        return f"/workspaces/{c.ws['id']}/powerbi/export-jobs/{job_id}"

    def test_mostra_o_andamento_do_proprio_trabalho(self, client, cenario):
        job = report_delivery.create_job(1)  # o admin e o usuario 1
        job.status, job.message, job.progress = "exporting", "Exportando...", 40

        resp = client.get(self._url(cenario, job.id), headers=cenario.admin)

        assert resp.json() == {"status": "exporting", "message": "Exportando...", "progress": 40}

    def test_trabalho_de_outra_pessoa_ou_inexistente_da_404(self, client, cenario):
        alheio = report_delivery.create_job(user_id=999)

        assert client.get(self._url(cenario, alheio.id), headers=cenario.admin).status_code == 404
        assert client.get(self._url(cenario, "nao-existe"), headers=cenario.admin).status_code == 404

    def test_exige_login(self, client, cenario):
        assert client.get(self._url(cenario, "x")).status_code == 401

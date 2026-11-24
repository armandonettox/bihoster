"""Exportar o relatorio em PDF ou imagem para baixar (sem e-mail): a rota que pede, o trabalho em segundo plano que guarda
o arquivo e a rota que entrega o arquivo uma vez so. Nenhum teste fala com o Power BI."""

import io
import zipfile
from unittest.mock import patch

import pytest

from app.core import powerbi, report_delivery
from app.models.audit_log import AuditLog
from tests.test_report_delivery import _headers, _pbi, cenario  # noqa: F401  (cenario e fixture)


def _url(c, rel_id=None):
    return f"/workspaces/{c.ws['id']}/powerbi/reports/{rel_id or c.rel['id']}/export-download"


def _pedir(client, c, body=None, headers=None, rls=False):
    p1, p2 = _pbi(rls=rls)
    with p1, p2, patch("app.routers.report_export.report_delivery.start_download_in_background") as iniciar:
        resp = client.post(_url(c), json=body or {}, headers=headers or c.admin)
    return resp, iniciar


class TestRotaPedirDownload:
    def test_pede_o_trabalho_e_a_thread_recebe_tudo_o_que_precisa(self, client, cenario):
        resp, iniciar = _pedir(client, cenario, {"format": "PDF"})

        assert resp.status_code == 202
        kw = iniciar.call_args.kwargs
        assert kw["job"].id == resp.json()["job_id"]
        assert (kw["pbi_workspace_id"], kw["pbi_report_id"], kw["fmt"]) == ("pbi-ws", "pbi-rel", "PDF")
        assert kw["report_name"] == "Vendas"
        # Sem pagina escolhida, exporta o relatorio inteiro (as paginas escolhidas para ele; vazio = todas)
        assert kw["page_names"] == []
        assert type(kw["connection"]).__name__ == "SimpleNamespace"

    def test_com_pagina_exporta_so_essa_pagina(self, client, cenario):
        p1, p2 = _pbi()
        paginas = [{"name": "ReportSection1", "displayName": "Resumo"}, {"name": "ReportSection2", "displayName": "Detalhe"}]
        with p1, p2, patch.object(powerbi, "list_pages", return_value=paginas), patch(
            "app.routers.report_export.report_delivery.start_download_in_background"
        ) as iniciar:
            resp = client.post(_url(cenario), json={"format": "PNG", "page_name": "ReportSection2"}, headers=cenario.admin)

        assert resp.status_code == 202
        kw = iniciar.call_args.kwargs
        assert kw["page_names"] == ["ReportSection2"] and kw["fmt"] == "PNG"
        assert kw["page_display_names"] == {"ReportSection1": "Resumo", "ReportSection2": "Detalhe"}

    def test_pagina_que_nao_existe_no_relatorio_e_recusada(self, client, cenario):
        p1, p2 = _pbi()
        paginas = [{"name": "ReportSection1", "displayName": "Resumo"}]
        with p1, p2, patch.object(powerbi, "list_pages", return_value=paginas), patch(
            "app.routers.report_export.report_delivery.start_download_in_background"
        ) as iniciar:
            resp = client.post(_url(cenario), json={"page_name": "Outra"}, headers=cenario.admin)

        assert resp.status_code == 400 and "Pagina" in resp.json()["detail"]
        iniciar.assert_not_called()

    def test_relatorio_com_rls_e_recusado(self, client, cenario):
        resp, iniciar = _pedir(client, cenario, rls=True)

        assert resp.status_code == 400 and "RLS" in resp.json()["detail"]
        iniciar.assert_not_called()

    def test_quem_nao_pode_exportar_e_quem_nao_entrou_sao_recusados(self, client, cenario):
        pessoa = _headers(client, "pessoa@example.com")

        resp, iniciar = _pedir(client, cenario, headers=pessoa)

        assert resp.status_code == 403
        iniciar.assert_not_called()
        assert client.post(_url(cenario), json={}).status_code == 401

    def test_relatorio_inexistente_da_404(self, client, cenario):
        assert client.post(_url(cenario, 9999), json={}, headers=cenario.admin).status_code == 404

    def test_formato_desconhecido_e_recusado(self, client, cenario):
        assert client.post(_url(cenario), json={"format": "DOCX"}, headers=cenario.admin).status_code == 422

    def test_powerpoint_e_aceito_e_vai_para_a_thread(self, client, cenario):
        resp, iniciar = _pedir(client, cenario, {"format": "PPTX"})

        assert resp.status_code == 202
        assert iniciar.call_args.kwargs["fmt"] == "PPTX"

    def test_valores_atuais_chegam_na_thread(self, client, cenario):
        resp, iniciar = _pedir(client, cenario, {"format": "PDF", "bookmark_state": "estado-123"})

        assert resp.status_code == 202
        assert iniciar.call_args.kwargs["bookmark_state"] == "estado-123"

    def test_sem_estado_usa_os_valores_padrao(self, client, cenario):
        _, iniciar = _pedir(client, cenario, {"format": "PDF"})

        assert iniciar.call_args.kwargs["bookmark_state"] is None

    def test_a_auditoria_diz_quando_o_pedido_foi_com_valores_atuais(self, client, cenario, db_session):
        _pedir(client, cenario, {"format": "PDF", "bookmark_state": "estado-123"})

        pedido = db_session.query(AuditLog).filter(AuditLog.action == "export_download_requested").one()
        assert pedido.details == "PDF, relatorio, valores atuais"

    def test_a_auditoria_registra_o_pedido_e_o_resultado(self, client, cenario, db_session):
        p1, p2 = _pbi()
        with p1, p2, patch("app.routers.report_export.report_delivery.start_download_in_background") as iniciar:
            client.post(_url(cenario), json={"format": "PNG", "page_name": "ReportSection1"}, headers=cenario.admin)

        with patch("app.routers.report_export.SessionLocal", lambda: db_session):
            iniciar.call_args.kwargs["on_finish"](True, "Arquivo pronto.")
            iniciar.call_args.kwargs["on_finish"](False, "capacidade sem suporte")

        acoes = {l.action: l.details for l in db_session.query(AuditLog).filter(AuditLog.action.like("export_download_%"))}
        assert acoes["export_download_requested"] == "PNG, pagina"
        assert acoes["export_download_done"] == "PNG"
        assert acoes["export_download_failed"] == "PNG: capacidade sem suporte"


def _zip(*nomes):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for n in nomes:
            z.writestr(n, b"img")
    return buf.getvalue()


class TestTrabalhoEmSegundoPlano:
    def _rodar(self, fmt="PDF", dados=b"%PDF", page_names=(), display=None, erro=None):
        job = report_delivery.create_job(1)
        efeito = {"side_effect": erro} if erro else {"return_value": dados}
        with patch.object(powerbi, "export_report", **efeito):
            report_delivery.run_download(
                job,
                connection=object(),
                pbi_workspace_id="ws",
                pbi_report_id="rel",
                page_names=list(page_names),
                fmt=fmt,
                report_name="Vendas Mensal",
                page_display_names=display,
            )
        return job

    def test_guarda_o_arquivo_pronto_no_trabalho(self):
        job = self._rodar()

        assert job.status == "done" and job.progress == 100
        assert job.file_data == b"%PDF"
        assert job.file_name == "Vendas Mensal.pdf" and job.file_mimetype == "application/pdf"

    def test_imagem_de_uma_pagina_leva_o_nome_da_pagina(self):
        job = self._rodar("PNG", b"\x89PNG", ["ReportSection1"], {"ReportSection1": "Resumo"})

        assert job.file_name == "Resumo.png" and job.file_mimetype == "image/png"

    def test_imagem_de_varias_paginas_vira_zip_com_os_nomes_das_paginas(self):
        job = self._rodar("PNG", _zip("ReportSection1.png", "ReportSection2.png"), [], {"ReportSection1": "Resumo", "ReportSection2": "Detalhe"})

        assert job.file_name == "Vendas Mensal.zip" and job.file_mimetype == "application/zip"
        assert sorted(zipfile.ZipFile(io.BytesIO(job.file_data)).namelist()) == ["Detalhe.png", "Resumo.png"]

    def test_erro_do_power_bi_vira_a_mensagem_do_trabalho(self):
        job = self._rodar(erro=powerbi.PowerBIError("capacidade sem suporte"))

        assert job.status == "error" and job.message == "capacidade sem suporte"
        assert job.file_data is None

    def test_erro_inesperado_nao_derruba_a_thread(self):
        job = self._rodar(erro=RuntimeError("boom"))

        assert job.status == "error" and "inesperado" in job.message.lower()

    def test_avisa_o_resultado_ao_terminar(self):
        resultados = []
        job = report_delivery.create_job(1)
        with patch.object(powerbi, "export_report", return_value=b"x"):
            report_delivery.run_download(
                job, connection=object(), pbi_workspace_id="w", pbi_report_id="r", page_names=[], fmt="PDF",
                report_name="R", on_finish=lambda ok, msg: resultados.append((ok, msg)),
            )

        assert resultados == [(True, "Arquivo pronto.")]


class TestRotaBaixarArquivo:
    def _trabalho_pronto(self, user_id=1):
        job = report_delivery.create_job(user_id)
        job.status, job.file_data = "done", b"%PDF-conteudo"
        job.file_name, job.file_mimetype = "Vendas.pdf", "application/pdf"
        return job

    def _dono(self, client, cenario, db_session):
        from app.models.user import User

        return db_session.query(User).filter(User.email == "admin@example.com").one().id

    def test_entrega_o_arquivo_com_o_nome_e_o_tipo_certos(self, client, cenario, db_session):
        job = self._trabalho_pronto(self._dono(client, cenario, db_session))

        resp = client.get(f"/workspaces/{cenario.ws['id']}/powerbi/export-jobs/{job.id}/file", headers=cenario.admin)

        assert resp.status_code == 200 and resp.content == b"%PDF-conteudo"
        assert resp.headers["content-type"] == "application/pdf"
        assert 'attachment; filename="Vendas.pdf"' in resp.headers["content-disposition"]
        assert resp.headers["cache-control"] == "no-store"

    def test_o_status_informa_o_nome_do_arquivo_so_enquanto_ele_nao_foi_baixado(self, client, cenario, db_session):
        job = self._trabalho_pronto(self._dono(client, cenario, db_session))
        base = f"/workspaces/{cenario.ws['id']}/powerbi/export-jobs/{job.id}"

        assert client.get(base, headers=cenario.admin).json()["file_name"] == "Vendas.pdf"
        client.get(f"{base}/file", headers=cenario.admin)
        assert client.get(base, headers=cenario.admin).json()["file_name"] is None

    def test_o_arquivo_sai_da_memoria_depois_do_primeiro_download(self, client, cenario, db_session):
        job = self._trabalho_pronto(self._dono(client, cenario, db_session))
        url = f"/workspaces/{cenario.ws['id']}/powerbi/export-jobs/{job.id}/file"

        assert client.get(url, headers=cenario.admin).status_code == 200
        assert client.get(url, headers=cenario.admin).status_code == 404
        assert job.file_data is None

    def test_so_quem_pediu_baixa(self, client, cenario):
        pessoa = _headers(client, "pessoa@example.com")
        job = self._trabalho_pronto(user_id=99999)

        assert client.get(f"/workspaces/{cenario.ws['id']}/powerbi/export-jobs/{job.id}/file", headers=pessoa).status_code == 404

    def test_trabalho_sem_arquivo_ou_inexistente_da_404(self, client, cenario, db_session):
        andamento = report_delivery.create_job(self._dono(client, cenario, db_session))
        base = f"/workspaces/{cenario.ws['id']}/powerbi/export-jobs"

        assert client.get(f"{base}/{andamento.id}/file", headers=cenario.admin).status_code == 404
        assert client.get(f"{base}/nao-existe/file", headers=cenario.admin).status_code == 404

    def test_sem_entrar_no_sistema_recusa(self, client, cenario):
        assert client.get(f"/workspaces/{cenario.ws['id']}/powerbi/export-jobs/x/file").status_code == 401


class TestPrepararArquivo:
    @pytest.mark.parametrize(
        ("fmt", "dados", "paginas", "nome_esperado", "tipo"),
        [
            ("PDF", b"%PDF", [], "Vendas.pdf", "application/pdf"),
            (
                "PPTX",
                b"PK",
                [],
                "Vendas.pptx",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ),
            ("PNG", b"\x89PNG", ["a"], "Pagina A.png", "image/png"),
            ("PNG", b"\x89PNG", ["x"], "Vendas.png", "image/png"),
        ],
    )
    def test_nome_e_tipo(self, fmt, dados, paginas, nome_esperado, tipo):
        _, mimetype, nome = report_delivery.prepare_export_file(fmt, dados, paginas, {"a": "Pagina A"}, "Vendas")

        assert (nome, mimetype) == (nome_esperado, tipo)

"""Exportar relatorio pela API ExportTo do Power BI: iniciar, acompanhar ate terminar e baixar o arquivo.
Nenhum teste fala com o Power BI: o cliente HTTP e simulado e o relogio e controlado."""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.core import powerbi

CONEXAO = SimpleNamespace(id=1, tenant_id="t", client_id="c", client_secret="s")


def _resp(status=200, payload=None, headers=None):
    return MagicMock(status_code=status, json=MagicMock(return_value=payload or {}), headers=headers or {}, text="")


@pytest.fixture(autouse=True)
def token_da_azure():
    with patch.object(powerbi, "_get_aad_token", return_value="token-aad"):
        yield


class TestGetExportStatus:
    def test_202_e_exportacao_em_andamento_e_nao_erro(self):
        corpo = {"status": "Running", "percentComplete": 40}
        with patch.object(powerbi._http, "get", return_value=_resp(202, corpo)):
            assert powerbi.get_export_status(CONEXAO, "ws", "rel", "exp-1") == corpo

    def test_200_e_exportacao_pronta(self):
        with patch.object(powerbi._http, "get", return_value=_resp(200, {"status": "Succeeded"})):
            assert powerbi.get_export_status(CONEXAO, "ws", "rel", "exp-1")["status"] == "Succeeded"

    def test_outros_codigos_continuam_sendo_erro(self):
        with patch.object(powerbi._http, "get", return_value=_resp(404)):
            with pytest.raises(powerbi.PowerBIError, match="consultar a exportacao"):
                powerbi.get_export_status(CONEXAO, "ws", "rel", "exp-1")


class TestStartExport:
    def test_pede_o_formato_e_devolve_o_id(self):
        with patch.object(powerbi._http, "post", return_value=_resp(202, {"id": "exp-1"})) as post:
            export_id = powerbi.start_export(CONEXAO, "ws", "rel", "PDF")

        assert export_id == "exp-1"
        assert post.call_args.args[0].endswith("/groups/ws/reports/rel/ExportTo")
        assert post.call_args.kwargs["json"] == {"format": "PDF"}
        assert post.call_args.kwargs["headers"] == {"Authorization": "Bearer token-aad"}

    def test_limita_as_abas_exportadas_quando_o_relatorio_tem_abas_escolhidas(self):
        with patch.object(powerbi._http, "post", return_value=_resp(202, {"id": "x"})) as post:
            powerbi.start_export(CONEXAO, "ws", "rel", "PNG", ["ReportSection1", "ReportSection2"])

        assert post.call_args.kwargs["json"]["powerBIReportConfiguration"] == {
            "pages": [{"pageName": "ReportSection1"}, {"pageName": "ReportSection2"}]
        }

    def test_sem_abas_escolhidas_exporta_o_relatorio_inteiro(self):
        with patch.object(powerbi._http, "post", return_value=_resp(202, {"id": "x"})) as post:
            powerbi.start_export(CONEXAO, "ws", "rel", "PDF", [])

        assert "powerBIReportConfiguration" not in post.call_args.kwargs["json"]

    def test_formato_desconhecido_nem_chega_a_chamar_o_power_bi(self):
        with patch.object(powerbi._http, "post") as post:
            with pytest.raises(powerbi.PowerBIError, match="Formato"):
                powerbi.start_export(CONEXAO, "ws", "rel", "DOCX")
        post.assert_not_called()

    def test_capacidade_sem_suporte_vira_erro_com_o_detalhe_do_power_bi(self):
        recusa = _resp(403, headers={"x-powerbi-error-info": "FeatureNotAvailable"})
        with patch.object(powerbi._http, "post", return_value=recusa):
            with pytest.raises(powerbi.PowerBIError, match="FeatureNotAvailable"):
                powerbi.start_export(CONEXAO, "ws", "rel", "PDF")


def _stream(status=200, pedacos=(b"abc",)):
    resposta = MagicMock(status_code=status, headers={}, text="")
    resposta.iter_bytes.return_value = iter(pedacos)

    @contextmanager
    def contexto(*args, **kwargs):
        yield resposta

    return contexto, resposta


class TestDownloadExport:
    def test_junta_os_pedacos_do_arquivo(self):
        contexto, _ = _stream(pedacos=(b"%PDF-", b"1.7", b" fim"))
        with patch.object(powerbi._http, "stream", contexto):
            assert powerbi.download_export(CONEXAO, "ws", "rel", "exp-1") == b"%PDF-1.7 fim"

    def test_para_de_baixar_quando_passa_do_limite(self):
        grande = b"x" * (powerbi.MAX_EXPORT_BYTES // 2 + 1)
        contexto, resposta = _stream(pedacos=(grande, grande, b"nunca lido"))
        with patch.object(powerbi._http, "stream", contexto):
            with pytest.raises(powerbi.PowerBIError, match="20 MB"):
                powerbi.download_export(CONEXAO, "ws", "rel", "exp-1")

    def test_erro_do_servidor_vira_powerbi_error(self):
        contexto, _ = _stream(status=404)
        with patch.object(powerbi._http, "stream", contexto):
            with pytest.raises(powerbi.PowerBIError, match="baixar"):
                powerbi.download_export(CONEXAO, "ws", "rel", "exp-1")


class TestExportReport:
    def _relogio(self):
        agora = [0.0]
        return (lambda: agora[0]), (lambda s: agora.__setitem__(0, agora[0] + s))

    def test_espera_terminar_acompanha_o_progresso_e_baixa(self):
        clock, sleep = self._relogio()
        status = [{"status": "Running", "percentComplete": 10}, {"status": "Running", "percentComplete": 60}, {"status": "Succeeded", "percentComplete": 100}]
        progresso = []
        with patch.object(powerbi, "start_export", return_value="exp-1"), patch.object(
            powerbi, "get_export_status", side_effect=status
        ), patch.object(powerbi, "download_export", return_value=b"arquivo") as baixar:
            dados = powerbi.export_report(CONEXAO, "ws", "rel", "PDF", on_progress=progresso.append, sleep=sleep, clock=clock)

        assert dados == b"arquivo"
        assert progresso == [10, 60, 100]
        baixar.assert_called_once_with(CONEXAO, "ws", "rel", "exp-1")

    def test_exportacao_que_falhou_no_power_bi_vira_erro(self):
        clock, sleep = self._relogio()
        with patch.object(powerbi, "start_export", return_value="exp-1"), patch.object(
            powerbi, "get_export_status", return_value={"status": "Failed"}
        ), patch.object(powerbi, "download_export") as baixar:
            with pytest.raises(powerbi.PowerBIError, match="falhou"):
                powerbi.export_report(CONEXAO, "ws", "rel", sleep=sleep, clock=clock)
        baixar.assert_not_called()

    def test_para_de_esperar_depois_do_prazo(self):
        clock, sleep = self._relogio()
        consultas = MagicMock(return_value={"status": "Running", "percentComplete": 5})
        with patch.object(powerbi, "start_export", return_value="exp-1"), patch.object(
            powerbi, "get_export_status", consultas
        ):
            with pytest.raises(powerbi.PowerBIError, match="demorou demais"):
                powerbi.export_report(CONEXAO, "ws", "rel", timeout_seconds=30, poll_seconds=10, sleep=sleep, clock=clock)

        assert consultas.call_count == 4  # em 0, 10, 20 e 30 segundos

    def test_repassa_formato_e_abas_para_o_inicio_da_exportacao(self):
        clock, sleep = self._relogio()
        with patch.object(powerbi, "start_export", return_value="e") as inicio, patch.object(
            powerbi, "get_export_status", return_value={"status": "Succeeded"}
        ), patch.object(powerbi, "download_export", return_value=b"x"):
            powerbi.export_report(CONEXAO, "ws", "rel", "PNG", ["P1"], sleep=sleep, clock=clock)

        inicio.assert_called_once_with(CONEXAO, "ws", "rel", "PNG", ["P1"])

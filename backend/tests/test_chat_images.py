"""Imagem da pagina do relatorio para a IA: guarda por pouco tempo, nunca bloqueia a pergunta, so exporta o
que foi pedido e descarta o que passa do tamanho."""

import io
import zipfile
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.core import chat_images, powerbi

CONEXAO = SimpleNamespace(id=1)
RELATORIO = SimpleNamespace(id=7, pbi_workspace_id="ws", pbi_report_id="rep")
PNG = b"\x89PNG-dados"


@pytest.fixture(autouse=True)
def _limpo():
    chat_images.clear()
    yield
    chat_images.clear()


def _zip_com(*arquivos: tuple[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as arquivo:
        for nome, dados in arquivos:
            arquivo.writestr(nome, dados)
    return buffer.getvalue()


class TestAquecer:
    def test_exporta_a_pagina_pedida_em_png_e_guarda(self):
        with patch.object(powerbi, "export_report", return_value=PNG) as exportar:
            estado = chat_images.warm(CONEXAO, RELATORIO, "ReportSection1", background=False)

        assert estado == "ready" and chat_images.get(7, "ReportSection1") == PNG
        exportar.assert_called_once_with(CONEXAO, "ws", "rep", "PNG", ["ReportSection1"])

    def test_zip_de_uma_pagina_vira_a_primeira_imagem(self):
        arquivo = _zip_com(("leia-me.txt", b"x"), ("pagina.png", PNG))

        with patch.object(powerbi, "export_report", return_value=arquivo):
            chat_images.warm(CONEXAO, RELATORIO, "P1", background=False)

        assert chat_images.get(7, "P1") == PNG

    def test_zip_sem_imagem_nao_guarda_nada(self):
        with patch.object(powerbi, "export_report", return_value=_zip_com(("a.txt", b"x"))):
            chat_images.warm(CONEXAO, RELATORIO, "P1", background=False)

        assert chat_images.get(7, "P1") is None

    def test_falha_do_power_bi_nao_guarda_e_libera_para_tentar_de_novo(self):
        with patch.object(powerbi, "export_report", side_effect=powerbi.PowerBIError("capacidade ocupada")):
            estado = chat_images.warm(CONEXAO, RELATORIO, "P1", background=False)

        assert estado == "warming" and chat_images.get(7, "P1") is None
        with patch.object(powerbi, "export_report", return_value=PNG):
            assert chat_images.warm(CONEXAO, RELATORIO, "P1", background=False) == "ready"

    def test_imagem_acima_do_limite_e_descartada(self):
        with patch.object(powerbi, "export_report", return_value=b"x" * (chat_images.MAX_IMAGE_BYTES + 1)):
            chat_images.warm(CONEXAO, RELATORIO, "P1", background=False)

        assert chat_images.get(7, "P1") is None

    def test_ja_pronta_nao_exporta_de_novo(self):
        chat_images._store((7, "P1"), PNG)

        with patch.object(powerbi, "export_report") as exportar:
            assert chat_images.warm(CONEXAO, RELATORIO, "P1") == "ready"

        exportar.assert_not_called()

    def test_ja_em_andamento_nao_exporta_de_novo(self):
        chat_images._in_flight.add((7, "P1"))

        with patch.object(powerbi, "export_report") as exportar:
            assert chat_images.warm(CONEXAO, RELATORIO, "P1") == "warming"

        exportar.assert_not_called()

    def test_em_segundo_plano_responde_na_hora_e_a_imagem_chega_depois(self):
        with patch.object(powerbi, "export_report", return_value=PNG), patch.object(chat_images.threading, "Thread") as thread:
            estado = chat_images.warm(CONEXAO, RELATORIO, "P1")

        assert estado == "warming" and chat_images.get(7, "P1") is None
        thread.assert_called_once()
        thread.return_value.start.assert_called_once()
        # Quem roda a thread e o proprio _run: ao rodar, a imagem aparece e a marca de andamento sai
        args = thread.call_args.kwargs["args"]
        with patch.object(powerbi, "export_report", return_value=PNG):
            chat_images._run(*args)
        assert chat_images.get(7, "P1") == PNG and (7, "P1") not in chat_images._in_flight


class TestGuardar:
    def test_a_imagem_vence_depois_do_prazo(self):
        chat_images._store((7, "P1"), PNG)
        depois = datetime.now(timezone.utc) + chat_images.IMAGE_TTL + timedelta(seconds=1)

        with patch.object(chat_images, "_now", return_value=depois):
            assert chat_images.get(7, "P1") is None

    def test_guarda_no_maximo_um_numero_de_imagens_e_tira_a_mais_antiga(self):
        for numero in range(chat_images.MAX_ENTRIES + 3):
            chat_images._store((numero, "P"), PNG)

        assert len(chat_images._cache) == chat_images.MAX_ENTRIES
        assert chat_images.get(0, "P") is None and chat_images.get(chat_images.MAX_ENTRIES + 2, "P") == PNG

    def test_cada_relatorio_e_pagina_tem_a_sua_imagem(self):
        chat_images._store((7, "P1"), b"um")
        chat_images._store((7, "P2"), b"dois")
        chat_images._store((8, "P1"), b"tres")

        assert (chat_images.get(7, "P1"), chat_images.get(7, "P2"), chat_images.get(8, "P1")) == (b"um", b"dois", b"tres")

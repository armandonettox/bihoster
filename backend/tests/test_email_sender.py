"""Envio de e-mail por SMTP: montagem da mensagem, escolha da conexao e traducao dos erros. O
servidor SMTP e sempre simulado: nenhum teste abre conexao de rede."""

import smtplib
import socket
import ssl
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.core import email_sender
from app.core.email_sender import Attachment, EmailError, SmtpConfig


def _config(**extra) -> SmtpConfig:
    base = dict(
        host="smtp.exemplo.test", port=587, security="starttls", username="usuario", password="segredo-smtp",
        from_email="relatorios@exemplo.test", from_name="BIHoster",
    )
    base.update(extra)
    return SmtpConfig(**base)


class TestLoadSmtpConfig:
    def test_sem_servidor_ou_sem_remetente_nao_esta_configurado(self):
        assert email_sender.load_smtp_config(None) is None
        assert email_sender.load_smtp_config(SimpleNamespace(smtp_host=None, smtp_from_email="a@b.c")) is None
        assert email_sender.load_smtp_config(SimpleNamespace(smtp_host="smtp.x", smtp_from_email=None)) is None

    def test_usa_os_padroes_quando_porta_e_seguranca_faltam(self):
        row = SimpleNamespace(
            smtp_host="smtp.x", smtp_port=None, smtp_security=None, smtp_username="",
            smtp_password=None, smtp_from_email="a@b.c", smtp_from_name="",
        )

        config = email_sender.load_smtp_config(row)

        assert (config.port, config.security) == (587, "starttls")
        assert config.username is None and config.from_name is None


class TestDominiosPermitidos:
    def test_sem_lista_qualquer_destinatario_vale(self):
        row = SimpleNamespace(email_allowed_domains=None)
        assert email_sender.disallowed_recipients(row, ["a@qualquer.com"]) == []

    def test_com_lista_barra_quem_esta_fora(self):
        row = SimpleNamespace(email_allowed_domains="empresa.com, parceiro.com.br")

        fora = email_sender.disallowed_recipients(row, ["ok@empresa.com", "ok2@EMPRESA.COM", "x@gmail.com"])

        assert fora == ["x@gmail.com"]

    def test_subdominio_nao_conta_como_dominio_permitido(self):
        row = SimpleNamespace(email_allowed_domains="empresa.com")
        assert email_sender.disallowed_recipients(row, ["x@mail.empresa.com"]) == ["x@mail.empresa.com"]


class TestMensagem:
    def test_monta_remetente_assunto_destinatarios_e_anexo(self):
        anexo = Attachment("Vendas.pdf", b"%PDF-1.7 corpo", "application/pdf")

        msg = email_sender.build_message(_config(), ["a@x.test", "b@x.test"], "Vendas", "Segue o relatorio", [anexo])

        assert msg["From"] == "BIHoster <relatorios@exemplo.test>"
        assert msg["To"] == "a@x.test, b@x.test"
        assert msg["Subject"] == "Vendas"
        partes = list(msg.iter_attachments())
        assert len(partes) == 1
        assert partes[0].get_filename() == "Vendas.pdf"
        assert partes[0].get_content_type() == "application/pdf"
        assert partes[0].get_payload(decode=True) == b"%PDF-1.7 corpo"

    def test_quebra_de_linha_no_assunto_nao_injeta_cabecalho(self):
        msg = email_sender.build_message(_config(), ["a@x.test"], "Vendas\r\nBcc: invasor@x.test", "corpo")

        assert msg["Bcc"] is None
        assert "\n" not in msg["Subject"] and "\r" not in msg["Subject"]

    def test_quebra_de_linha_no_nome_do_remetente_tambem_e_limpa(self):
        msg = email_sender.build_message(_config(from_name="Nome\nBcc: x@y.test"), ["a@x.test"], "Oi", "corpo")

        assert msg["Bcc"] is None


@pytest.fixture
def smtp_falso():
    """Troca smtplib.SMTP e SMTP_SSL por servidores de mentira que guardam o que receberam"""
    servidor = MagicMock()
    with patch.object(email_sender.smtplib, "SMTP", return_value=servidor) as smtp, patch.object(
        email_sender.smtplib, "SMTP_SSL", return_value=servidor
    ) as smtp_ssl:
        yield SimpleNamespace(servidor=servidor, smtp=smtp, smtp_ssl=smtp_ssl)


class TestEnvio:
    def test_starttls_abre_conexao_comum_e_sobe_para_tls_antes_de_autenticar(self, smtp_falso):
        email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        smtp_falso.smtp.assert_called_once()
        smtp_falso.smtp_ssl.assert_not_called()
        ordem = [c[0] for c in smtp_falso.servidor.method_calls]
        assert ordem.index("starttls") < ordem.index("login") < ordem.index("send_message")
        smtp_falso.servidor.login.assert_called_once_with("usuario", "segredo-smtp")
        smtp_falso.servidor.quit.assert_called_once()

    def test_ssl_abre_a_conexao_ja_criptografada_sem_starttls(self, smtp_falso):
        email_sender.send_email(_config(security="ssl", port=465), ["a@x.test"], "Oi", "corpo")

        smtp_falso.smtp_ssl.assert_called_once()
        smtp_falso.smtp.assert_not_called()
        smtp_falso.servidor.starttls.assert_not_called()

    def test_sem_seguranca_nao_sobe_tls(self, smtp_falso):
        email_sender.send_email(_config(security="none", username=None, password=None), ["a@x.test"], "Oi", "corpo")

        smtp_falso.servidor.starttls.assert_not_called()
        smtp_falso.servidor.login.assert_not_called()

    def test_sem_usuario_nao_tenta_autenticar(self, smtp_falso):
        email_sender.send_email(_config(username=None, password=None), ["a@x.test"], "Oi", "corpo")

        smtp_falso.servidor.login.assert_not_called()

    def test_valida_o_certificado_do_servidor(self, smtp_falso):
        email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        contexto = smtp_falso.servidor.starttls.call_args.kwargs["context"]
        assert contexto.verify_mode == ssl.CERT_REQUIRED
        assert contexto.check_hostname is True


class TestLimites:
    def test_exige_ao_menos_um_destinatario(self, smtp_falso):
        with pytest.raises(EmailError, match="Nenhum destinatario"):
            email_sender.send_email(_config(), [], "Oi", "corpo")

    def test_limita_a_quantidade_de_destinatarios(self, smtp_falso):
        muitos = [f"p{i}@x.test" for i in range(email_sender.MAX_RECIPIENTS + 1)]

        with pytest.raises(EmailError, match="No maximo"):
            email_sender.send_email(_config(), muitos, "Oi", "corpo")
        smtp_falso.smtp.assert_not_called()

    def test_recusa_anexo_grande_demais_sem_abrir_conexao(self, smtp_falso):
        enorme = Attachment("g.pdf", b"x" * (email_sender.MAX_ATTACHMENT_BYTES + 1), "application/pdf")

        with pytest.raises(EmailError, match="20 MB"):
            email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo", [enorme])
        smtp_falso.smtp.assert_not_called()


class TestErros:
    @pytest.mark.parametrize(
        "excecao, trecho",
        [
            (smtplib.SMTPAuthenticationError(535, b"bad credentials"), "usuario ou a senha"),
            (smtplib.SMTPRecipientsRefused({"a@x.test": (550, b"no")}), "destinatarios"),
            (smtplib.SMTPSenderRefused(553, b"no", "relatorios@exemplo.test"), "remetente"),
            (ssl.SSLError("handshake"), "conexao segura"),
            (socket.gaierror("nao resolve"), "conectar a smtp.exemplo.test:587"),
            (TimeoutError("lento"), "conectar a smtp.exemplo.test:587"),
            (ConnectionRefusedError("recusou"), "conectar a smtp.exemplo.test:587"),
            (smtplib.SMTPException("qualquer coisa interna"), "recusou o envio"),
        ],
    )
    def test_cada_falha_vira_uma_mensagem_clara(self, smtp_falso, excecao, trecho):
        smtp_falso.servidor.send_message.side_effect = excecao

        with pytest.raises(EmailError, match=trecho):
            email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

    def test_falha_de_conexao_tambem_e_traduzida(self):
        with patch.object(email_sender.smtplib, "SMTP", side_effect=socket.gaierror("nao resolve")):
            with pytest.raises(EmailError, match="conectar a smtp.exemplo.test:587"):
                email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

    def test_a_senha_nunca_aparece_na_mensagem_de_erro(self, smtp_falso):
        smtp_falso.servidor.login.side_effect = smtplib.SMTPAuthenticationError(535, b"senha segredo-smtp invalida")

        with pytest.raises(EmailError) as erro:
            email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        assert "segredo-smtp" not in str(erro.value)

    def test_fecha_a_conexao_mesmo_quando_o_envio_falha(self, smtp_falso):
        smtp_falso.servidor.send_message.side_effect = smtplib.SMTPException("x")

        with pytest.raises(EmailError):
            email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        smtp_falso.servidor.quit.assert_called_once()

    def test_erro_ao_fechar_a_conexao_nao_mascara_o_sucesso(self, smtp_falso):
        smtp_falso.servidor.quit.side_effect = smtplib.SMTPServerDisconnected("caiu")

        email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")  # nao levanta

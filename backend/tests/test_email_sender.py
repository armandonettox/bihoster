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
    servidor.esmtp_features = {"auth": "LOGIN PLAIN XOAUTH2"}  # o que o Google oferece
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
        assert ordem.index("starttls") < ordem.index("auth") < ordem.index("send_message")
        smtp_falso.servidor.auth.assert_called_once()
        metodo, objeto = smtp_falso.servidor.auth.call_args.args
        assert metodo == "PLAIN"
        assert objeto() == "\0usuario\0segredo-smtp"
        assert smtp_falso.servidor.auth.call_args.kwargs["initial_response_ok"] is False
        smtp_falso.servidor.login.assert_not_called()  # o login() tenta um 2o metodo e esconde o erro real
        smtp_falso.servidor.quit.assert_called_once()

    def test_ssl_abre_a_conexao_ja_criptografada_sem_starttls(self, smtp_falso):
        email_sender.send_email(_config(security="ssl", port=465), ["a@x.test"], "Oi", "corpo")

        smtp_falso.smtp_ssl.assert_called_once()
        smtp_falso.smtp.assert_not_called()
        smtp_falso.servidor.starttls.assert_not_called()

    def test_sem_seguranca_nao_sobe_tls(self, smtp_falso):
        email_sender.send_email(_config(security="none", username=None, password=None), ["a@x.test"], "Oi", "corpo")

        smtp_falso.servidor.starttls.assert_not_called()
        smtp_falso.servidor.auth.assert_not_called()

    def test_sem_usuario_nao_tenta_autenticar(self, smtp_falso):
        email_sender.send_email(_config(username=None, password=None), ["a@x.test"], "Oi", "corpo")

        smtp_falso.servidor.auth.assert_not_called()
        smtp_falso.servidor.login.assert_not_called()

    def test_valida_o_certificado_do_servidor(self, smtp_falso):
        email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        contexto = smtp_falso.servidor.starttls.call_args.kwargs["context"]
        assert contexto.verify_mode == ssl.CERT_REQUIRED
        assert contexto.check_hostname is True


class TestMetodoDeLogin:
    def test_so_tenta_um_metodo_mesmo_quando_o_servidor_oferece_varios(self, smtp_falso):
        email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        assert smtp_falso.servidor.auth.call_count == 1

    def test_sem_plain_usa_login(self, smtp_falso):
        smtp_falso.servidor.esmtp_features = {"auth": "LOGIN XOAUTH2"}

        email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        assert smtp_falso.servidor.auth.call_args.args[0] == "LOGIN"
        assert (smtp_falso.servidor.user, smtp_falso.servidor.password) == ("usuario", "segredo-smtp")

    def test_servidor_com_outro_metodo_deixa_o_smtplib_escolher(self, smtp_falso):
        smtp_falso.servidor.esmtp_features = {"auth": "CRAM-MD5"}

        email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        smtp_falso.servidor.login.assert_called_once_with("usuario", "segredo-smtp")
        smtp_falso.servidor.auth.assert_not_called()


class TestSenhaDeAppDoGoogle:
    def _senha_enviada(self, smtp_falso, **extra):
        email_sender.send_email(_config(**extra), ["a@x.test"], "Oi", "corpo")
        return smtp_falso.servidor.auth.call_args.args[1]()

    def test_tira_os_espacos_da_senha_de_app_copiada_em_grupos_de_4(self, smtp_falso):
        enviada = self._senha_enviada(smtp_falso, host="smtp.gmail.com", password="abcd efgh ijkl mnop")

        assert enviada == "\0usuario\0abcdefghijklmnop"

    def test_vale_tambem_para_o_rele_do_google(self, smtp_falso):
        enviada = self._senha_enviada(smtp_falso, host="smtp-relay.gmail.com", password="abcd efgh ijkl mnop")

        assert enviada.endswith("abcdefghijklmnop")

    def test_senha_que_nao_parece_senha_de_app_nao_e_alterada(self, smtp_falso):
        enviada = self._senha_enviada(smtp_falso, host="smtp.gmail.com", password="minha senha com espacos")

        assert enviada.endswith("minha senha com espacos")

    def test_outros_servidores_nunca_tem_a_senha_alterada(self, smtp_falso):
        enviada = self._senha_enviada(smtp_falso, host="smtp.outro.com", password="abcd efgh ijkl mnop")

        assert enviada.endswith("abcd efgh ijkl mnop")


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

    @pytest.mark.parametrize(
        "metodo, etapa",
        [
            ("ehlo", "iniciar a conversa"),
            ("starttls", "STARTTLS"),
            ("auth", "fazer o login"),
            ("send_message", "enviar a mensagem"),
        ],
    )
    def test_conexao_fechada_pelo_servidor_diz_em_que_etapa_aconteceu(self, smtp_falso, metodo, etapa):
        getattr(smtp_falso.servidor, metodo).side_effect = smtplib.SMTPServerDisconnected("Connection unexpectedly closed")

        with pytest.raises(EmailError, match=f"fechou a conexao ao .*{etapa}"):
            email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

    def test_resposta_do_servidor_aparece_com_o_codigo(self, smtp_falso):
        smtp_falso.servidor.send_message.side_effect = smtplib.SMTPDataError(
            550, b"5.7.1 Message rejected due to\n local policy"
        )

        with pytest.raises(EmailError) as erro:
            email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        assert "(550)" in str(erro.value)
        assert "5.7.1 Message rejected due to local policy" in str(erro.value)  # varias linhas viram uma
        assert "enviar a mensagem" in str(erro.value)

    def test_servidor_sem_o_recurso_pedido(self, smtp_falso):
        smtp_falso.servidor.starttls.side_effect = smtplib.SMTPNotSupportedError("STARTTLS extension not supported by server.")

        with pytest.raises(EmailError, match="nao oferece o recurso .*STARTTLS"):
            email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

    def test_a_resposta_do_servidor_e_limitada(self, smtp_falso):
        smtp_falso.servidor.send_message.side_effect = smtplib.SMTPDataError(554, b"x" * 5000)

        with pytest.raises(EmailError) as erro:
            email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        assert len(str(erro.value)) < 400

    def test_o_log_registra_a_etapa_e_nunca_a_senha(self, smtp_falso, caplog):
        smtp_falso.servidor.send_message.side_effect = smtplib.SMTPServerDisconnected("caiu")

        with caplog.at_level("WARNING", logger="app.core.email_sender"):
            with pytest.raises(EmailError):
                email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        texto = " ".join(r.getMessage() for r in caplog.records)
        assert "enviar a mensagem" in texto
        assert "segredo-smtp" not in texto

    def test_login_recusado_mostra_o_codigo_e_o_texto_do_servidor_com_uma_dica(self, smtp_falso):
        smtp_falso.servidor.auth.side_effect = smtplib.SMTPAuthenticationError(
            535, b"5.7.8 Username and Password not accepted. Learn more at\n 5.7.8 https://support.google.com/mail"
        )

        with pytest.raises(EmailError) as erro:
            email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        mensagem = str(erro.value)
        assert "recusou o usuario ou a senha (535)" in mensagem
        assert "5.7.8 Username and Password not accepted" in mensagem
        assert "senha de app de 16 letras" in mensagem

    def test_google_pedindo_senha_de_app_explica_como_gerar(self, smtp_falso):
        smtp_falso.servidor.auth.side_effect = smtplib.SMTPAuthenticationError(
            534, b"5.7.9 Application-specific password required"
        )

        with pytest.raises(EmailError, match="myaccount.google.com/apppasswords"):
            email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

    def test_servidor_que_repete_a_senha_na_resposta_nao_a_mostra(self, smtp_falso):
        smtp_falso.servidor.auth.side_effect = smtplib.SMTPAuthenticationError(535, b"senha segredo-smtp nao aceita")

        with pytest.raises(EmailError) as erro:
            email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        assert "segredo-smtp" not in str(erro.value)
        assert "***" in str(erro.value)

    def test_o_log_do_login_recusado_tambem_nao_tem_a_senha(self, smtp_falso, caplog):
        smtp_falso.servidor.auth.side_effect = smtplib.SMTPAuthenticationError(535, b"senha segredo-smtp nao aceita")

        with caplog.at_level("WARNING", logger="app.core.email_sender"):
            with pytest.raises(EmailError):
                email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

        assert "segredo-smtp" not in " ".join(r.getMessage() for r in caplog.records)

    def test_falha_de_conexao_tambem_e_traduzida(self):
        with patch.object(email_sender.smtplib, "SMTP", side_effect=socket.gaierror("nao resolve")):
            with pytest.raises(EmailError, match="conectar a smtp.exemplo.test:587"):
                email_sender.send_email(_config(), ["a@x.test"], "Oi", "corpo")

    def test_a_senha_nunca_aparece_na_mensagem_de_erro(self, smtp_falso):
        smtp_falso.servidor.auth.side_effect = smtplib.SMTPAuthenticationError(535, b"senha segredo-smtp invalida")

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

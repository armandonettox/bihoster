"""Envio de e-mail por SMTP (so biblioteca padrao do Python) para as assinaturas de relatorio.

O servidor vem das configuracoes (AppSettings.smtp_*), nunca de variavel de ambiente, para o
administrador configurar e testar pela propria tela. A senha nunca aparece em mensagem de erro."""

import logging
import smtplib
import socket
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr
from typing import Optional, Sequence

logger = logging.getLogger(__name__)

SMTP_TIMEOUT_SECONDS = 30
# Quase todo servidor recusa mensagens acima de ~25 MB; o limite daqui deixa folga pro corpo do e-mail
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
MAX_RECIPIENTS = 20


class EmailError(Exception):
    """Falha de envio com mensagem segura pra mostrar ao usuario (sem senha nem detalhe interno)."""


@dataclass(frozen=True)
class SmtpConfig:
    host: str
    port: int
    security: str  # "starttls", "ssl" ou "none"
    username: Optional[str]
    password: Optional[str]
    from_email: str
    from_name: Optional[str]


@dataclass(frozen=True)
class Attachment:
    filename: str
    data: bytes
    mimetype: str  # ex: "application/pdf"


def load_smtp_config(settings_row) -> Optional[SmtpConfig]:
    """Monta a configuracao a partir das AppSettings, ou None se o e-mail ainda nao foi configurado
    (precisa de servidor e de um remetente)."""
    if not settings_row or not settings_row.smtp_host or not settings_row.smtp_from_email:
        return None
    return SmtpConfig(
        host=settings_row.smtp_host,
        port=settings_row.smtp_port or 587,
        security=settings_row.smtp_security or "starttls",
        username=settings_row.smtp_username or None,
        password=settings_row.smtp_password or None,
        from_email=settings_row.smtp_from_email,
        from_name=settings_row.smtp_from_name or None,
    )


def allowed_domains(settings_row) -> list[str]:
    raw = (settings_row.email_allowed_domains or "") if settings_row else ""
    return [d for d in (part.strip().lower() for part in raw.split(",")) if d]


def disallowed_recipients(settings_row, recipients: Sequence[str]) -> list[str]:
    """Destinatarios fora dos dominios permitidos. Sem lista configurada, qualquer um e permitido."""
    domains = allowed_domains(settings_row)
    if not domains:
        return []
    return [r for r in recipients if r.rsplit("@", 1)[-1].lower() not in domains]


def _login(server: smtplib.SMTP, username: str, password: str) -> None:
    """Login com UM metodo so. O `smtplib.login()` tenta PLAIN e, se o servidor recusa a credencial, tenta
    LOGIN em seguida; servidores como o Google fecham a conexao depois da primeira recusa, entao a segunda
    tentativa estoura "conexao fechada" e esconde o motivo verdadeiro: a resposta 535 do servidor."""
    offered = server.esmtp_features.get("auth", "").upper().split()
    if "PLAIN" in offered:
        server.auth("PLAIN", lambda challenge=None: f"\0{username}\0{password}", initial_response_ok=False)
    elif "LOGIN" in offered:
        server.user, server.password = username, password
        server.auth("LOGIN", server.auth_login, initial_response_ok=False)
    else:
        server.login(username, password)  # outros metodos (ex: CRAM-MD5): o smtplib escolhe


def _password_for(config: SmtpConfig) -> str:
    """Senha a enviar. A senha de app do Google e mostrada em grupos de 4 letras separados por espaco, mas
    sao 16 letras seguidas: quem copia com os espacos tem o login recusado. So para servidores do Google."""
    password = config.password or ""
    if config.host.lower().endswith("gmail.com"):
        compact = "".join(password.split())
        if len(compact) == 16 and compact.isalnum():
            return compact
    return password


def _login_hint(code: int, detail: str) -> str:
    """Dica do que conferir, conforme o que o servidor respondeu."""
    if code == 534 or "5.7.9" in detail or "pplication-specific" in detail:
        return (
            "O Google exige uma senha de app: gere em myaccount.google.com/apppasswords, "
            "com a verificacao em duas etapas ligada nessa conta."
        )
    if "5.7.8" in detail or code == 535:
        return (
            "Confira o usuario (o e-mail completo) e a senha. No Google use a senha de app de 16 letras, "
            "nao a senha da conta."
        )
    return "Confira o usuario e a senha."


def _short(value) -> str:
    """Texto curto e de uma linha so, pra mensagem e log (a resposta do servidor pode ter varias linhas)."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    return " ".join(str(value).split())[:200]


def _clean_header(value: str) -> str:
    """Cabecalho de e-mail nao pode ter quebra de linha (injecao de cabecalho)."""
    return " ".join(value.replace("\r", " ").replace("\n", " ").split())


def build_message(
    config: SmtpConfig, to: Sequence[str], subject: str, body: str, attachments: Sequence[Attachment] = ()
) -> EmailMessage:
    message = EmailMessage()
    message["From"] = formataddr((_clean_header(config.from_name or ""), config.from_email))
    message["To"] = ", ".join(to)
    message["Subject"] = _clean_header(subject)
    message.set_content(body)
    for attachment in attachments:
        maintype, _, subtype = attachment.mimetype.partition("/")
        message.add_attachment(
            attachment.data, maintype=maintype, subtype=subtype or "octet-stream", filename=_clean_header(attachment.filename)
        )
    return message


def send_email(
    config: SmtpConfig,
    to: Sequence[str],
    subject: str,
    body: str,
    attachments: Sequence[Attachment] = (),
) -> None:
    """Envia o e-mail. Levanta EmailError (mensagem segura) em qualquer falha."""
    if not to:
        raise EmailError("Nenhum destinatario informado.")
    if len(to) > MAX_RECIPIENTS:
        raise EmailError(f"No maximo {MAX_RECIPIENTS} destinatarios por envio.")
    if sum(len(a.data) for a in attachments) > MAX_ATTACHMENT_BYTES:
        raise EmailError("O anexo passa de 20 MB, acima do que os servidores de e-mail costumam aceitar.")

    message = build_message(config, to, subject, body, attachments)
    context = ssl.create_default_context()
    server: Optional[smtplib.SMTP] = None
    # Etapa em andamento: entra na mensagem de erro, porque "o servidor fechou a conexao" so ajuda
    # quando diz em que momento (nas configuracoes, no login ou no envio da mensagem)
    stage = "conectar ao servidor"
    try:
        if config.security == "ssl":
            server = smtplib.SMTP_SSL(config.host, config.port, timeout=SMTP_TIMEOUT_SECONDS, context=context)
        else:
            server = smtplib.SMTP(config.host, config.port, timeout=SMTP_TIMEOUT_SECONDS)
            stage = "iniciar a conversa com o servidor"
            server.ehlo()
            if config.security == "starttls":
                stage = "ativar a criptografia (STARTTLS)"
                server.starttls(context=context)
                server.ehlo()
        if config.username:
            stage = "fazer o login"
            _login(server, config.username, _password_for(config))
        stage = "enviar a mensagem"
        server.send_message(message)
    except smtplib.SMTPAuthenticationError as exc:
        # O texto vem do servidor (ex: "535 5.7.8 Username and Password not accepted") e diz o motivo
        # real. Se algum servidor o repetir com a senha dentro, ela e coberta antes de aparecer.
        detail = _short(exc.smtp_error)
        for secret in {config.password or "", _password_for(config)}:
            if secret:
                detail = detail.replace(secret, "***")
        logger.warning("SMTP: login recusado (%s): %s", exc.smtp_code, detail)
        raise EmailError(
            f"O servidor recusou o usuario ou a senha ({exc.smtp_code}): {detail} {_login_hint(exc.smtp_code, detail)}"
        ) from None
    except smtplib.SMTPRecipientsRefused:
        raise EmailError("O servidor recusou um ou mais destinatarios.") from None
    except smtplib.SMTPSenderRefused:
        raise EmailError("O servidor recusou o remetente. Confira o e-mail de origem nas configuracoes.") from None
    except ssl.SSLError:
        raise EmailError("Falha na conexao segura (TLS). Confira o tipo de seguranca e a porta.") from None
    except (socket.gaierror, ConnectionError, TimeoutError, socket.timeout, smtplib.SMTPConnectError):
        raise EmailError(f"Nao foi possivel conectar a {config.host}:{config.port}.") from None
    except smtplib.SMTPServerDisconnected as exc:
        logger.warning("SMTP: conexao fechada ao %s: %s", stage, _short(exc))
        raise EmailError(
            f"O servidor fechou a conexao ao {stage}. Confira o usuario, a senha e o e-mail de origem, "
            "e se a conta tem permissao para enviar por SMTP."
        ) from None
    except smtplib.SMTPNotSupportedError as exc:
        logger.warning("SMTP: recurso nao oferecido ao %s: %s", stage, _short(exc))
        raise EmailError(
            f"O servidor nao oferece o recurso necessario para {stage}. Confira o tipo de seguranca e a porta."
        ) from None
    except smtplib.SMTPResponseException as exc:
        # O codigo e o texto que o servidor devolveu (ex: "550 5.7.1 ...") dizem o motivo real. Nunca
        # contem a senha: o erro de login tem o proprio tratamento acima, com mensagem fixa.
        detail = _short(exc.smtp_error)
        logger.warning("SMTP: resposta %s ao %s: %s", exc.smtp_code, stage, detail)
        raise EmailError(f"O servidor recusou o envio ao {stage} ({exc.smtp_code}): {detail}") from None
    except smtplib.SMTPException as exc:
        logger.warning("SMTP: %s ao %s: %s", type(exc).__name__, stage, _short(exc))
        raise EmailError(f"O servidor de e-mail recusou o envio ao {stage}.") from None
    finally:
        if server is not None:
            try:
                server.quit()
            except Exception:  # noqa: BLE001 -- fechar a conexao nunca deve mascarar o resultado do envio
                pass

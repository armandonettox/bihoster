"""E-mails de conta e acesso: aviso de que a pessoa foi adicionada (ou convidada), link de redefinicao de senha e os avisos do
pedido de mais tempo de acesso.

Todos usam o servidor de e-mail das Configuracoes e o endereco do site (campo "site_url"), que vira o comeco dos links.
O texto de cada um vem de core/email_templates.py (o padrao, ou o que o administrador escreveu na aba E-mail) e sai em HTML
com a marca, mais a versao em texto puro. Nenhum dado de relatorio sai nesses e-mails, entao a lista de dominios permitidos
das assinaturas nao se aplica aqui."""

from typing import Optional

from sqlalchemy.orm import Session

from app.core import email_templates
from app.core.email_sender import EmailError, SmtpConfig, load_smtp_config, send_email


class AccountEmailError(Exception):
    """Falha com mensagem segura para mostrar a quem pediu o envio."""


def site_base_url(settings_row) -> str | None:
    """O começo dos links: o endereço do site das Configurações, sem barra no fim e com https quando vier sem protocolo."""
    value = ((getattr(settings_row, "site_url", None) or "").strip()).rstrip("/")
    if not value:
        return None
    if not value.lower().startswith(("http://", "https://")):
        value = "https://" + value
    return value


def ensure_ready(settings_row) -> tuple[SmtpConfig, str]:
    """Confere que dá para mandar e-mail com link: servidor de e-mail configurado e endereço do site preenchido."""
    config = load_smtp_config(settings_row)
    if config is None:
        raise AccountEmailError("Configure o servidor de e-mail em Administração > E-mail antes de enviar.")
    base = site_base_url(settings_row)
    if base is None:
        raise AccountEmailError("Preencha o endereço do site em Administração > Geral para o e-mail levar o link certo.")
    return config, base


def greeting(name: Optional[str]) -> str:
    return f"Olá, {name}." if name else "Olá."


GOOGLE_NOTICE = "Se preferir, entre com o botão do Google usando este mesmo e-mail."


def _deliver(
    db: Session, settings_row, key: str, to_email: str, values: dict[str, str], link_path: Optional[str] = None
) -> None:
    """Monta o e-mail `key` com o texto que vale hoje e envia. `link_path` e o caminho do botao, depois do endereco do site."""
    config, base = ensure_ready(settings_row)
    brand = email_templates.brand_from_settings(settings_row, base)
    rendered = email_templates.render(
        email_templates.effective(db, key),
        {**values, "empresa": brand.company},
        brand,
        f"{base}{link_path}" if link_path else None,
    )
    try:
        # Texto puro e HTML juntos; o HTML vai como argumento nomeado
        send_email(config, [to_email], rendered.subject, rendered.text, html=rendered.html)
    except EmailError as exc:
        raise AccountEmailError(str(exc)) from None


def send_added_email(db: Session, settings_row, to_email: str, to_name: Optional[str], has_account: bool) -> None:
    """Avisa que a pessoa foi adicionada. Com conta, o link leva para entrar; sem conta (só convite), para criar a conta."""
    google = GOOGLE_NOTICE if getattr(settings_row, "google_oauth_enabled", False) else ""
    values = {"saudacao": greeting(to_name), "google": google}
    if has_account:
        _deliver(db, settings_row, "added", to_email, values, "/login")
    else:
        _deliver(db, settings_row, "invited", to_email, {**values, "email": to_email}, "/register")


def send_extension_request_email(
    db: Session, settings_row, to_email: str, to_name: Optional[str], requester_name: str, reason: str
) -> None:
    """Avisa quem pode liberar que alguém pediu mais tempo de acesso. O link leva para Gerenciar usuários."""
    values = {"saudacao": greeting(to_name), "solicitante": requester_name, "motivo": reason}
    _deliver(db, settings_row, "extension_request", to_email, values, "/users")


def send_extension_decision_email(
    db: Session,
    settings_row,
    to_email: str,
    to_name: Optional[str],
    approved: bool,
    until_text: Optional[str] = None,
    note: Optional[str] = None,
) -> None:
    """Conta a quem pediu mais tempo de acesso como o pedido ficou. Aprovado: até quando vale e o link para entrar."""
    if approved:
        values = {"saudacao": greeting(to_name), "ate": until_text or ""}
        _deliver(db, settings_row, "extension_approved", to_email, values, "/login")
    else:
        values = {"saudacao": greeting(to_name), "motivo": note or ""}
        _deliver(db, settings_row, "extension_denied", to_email, values)


def send_reset_email(
    db: Session, settings_row, to_email: str, to_name: Optional[str], token: str, expires_in_minutes: int
) -> None:
    """Manda o link para a pessoa criar uma senha nova. O link vale por pouco tempo."""
    values = {"saudacao": greeting(to_name), "minutos": str(expires_in_minutes)}
    _deliver(db, settings_row, "reset", to_email, values, f"/reset-password?token={token}")

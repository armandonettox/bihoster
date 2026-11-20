"""E-mails de conta: o aviso de que a pessoa foi adicionada (com o link para entrar) e o link de redefinição de senha.

Os dois usam o servidor de e-mail das Configurações e o endereço do site (campo "site_url"), que vira o começo dos links.
Nenhum dado de relatório sai nesses e-mails, então a lista de domínios permitidos das assinaturas não se aplica aqui."""

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
        raise AccountEmailError("Configure o servidor de e-mail em Configuracoes > E-mail antes de enviar.")
    base = site_base_url(settings_row)
    if base is None:
        raise AccountEmailError("Preencha o endereco do site em Configuracoes > Geral para o e-mail levar o link certo.")
    return config, base


def _company(settings_row) -> str:
    return (getattr(settings_row, "company_name", None) or "BIHoster").strip() or "BIHoster"


def _send(config: SmtpConfig, to_email: str, subject: str, body: str) -> None:
    try:
        send_email(config, [to_email], subject, body)
    except EmailError as exc:
        raise AccountEmailError(str(exc)) from None


def send_added_email(settings_row, to_email: str, to_name: str | None, has_account: bool) -> None:
    """Avisa que a pessoa foi adicionada. Com conta, o link leva para entrar; sem conta (só convite), para criar a conta."""
    config, base = ensure_ready(settings_row)
    company = _company(settings_row)
    greeting = f"Olá, {to_name}." if to_name else "Olá."
    google = ""
    if getattr(settings_row, "google_oauth_enabled", False):
        google = "\nSe preferir, entre com o botão do Google usando este mesmo e-mail.\n"
    if has_account:
        subject = f"Você foi adicionado ao {company}"
        body = (
            f"{greeting}\n\n"
            f"Você foi adicionado ao {company}. Para entrar, acesse:\n{base}/login\n{google}\n"
            "Se você não lembra a senha, use a opção de esqueci a senha na tela de entrada, "
            "ou peça a quem te adicionou para enviar um link de redefinição.\n"
        )
    else:
        subject = f"Você foi convidado para o {company}"
        body = (
            f"{greeting}\n\n"
            f"Você foi convidado para o {company}. Para criar a sua conta, acesse:\n{base}/register\n\n"
            f"Use este e-mail ({to_email}) no cadastro, para o acesso já vir liberado.\n{google}"
        )
    _send(config, to_email, subject, body)


def send_extension_request_email(settings_row, to_email: str, to_name: str | None, requester_name: str, reason: str) -> None:
    """Avisa quem pode liberar que alguém pediu mais tempo de acesso. O link leva para Gerenciar usuários."""
    config, base = ensure_ready(settings_row)
    company = _company(settings_row)
    greeting = f"Olá, {to_name}." if to_name else "Olá."
    subject = f"Pedido de mais tempo de acesso - {company}"
    body = (
        f"{greeting}\n\n"
        f"{requester_name} está fora do horário de acesso ao {company} e pediu mais tempo.\n\n"
        f"Motivo: {reason}\n\n"
        f"Para aprovar ou recusar, acesse:\n{base}/users\n"
    )
    _send(config, to_email, subject, body)


def send_extension_decision_email(
    settings_row, to_email: str, to_name: str | None, approved: bool, until_text: str | None = None, note: str | None = None
) -> None:
    """Conta a quem pediu mais tempo de acesso como o pedido ficou. Aprovado: até quando vale e o link para entrar."""
    config, base = ensure_ready(settings_row)
    company = _company(settings_row)
    greeting = f"Olá, {to_name}." if to_name else "Olá."
    if approved:
        subject = f"Seu pedido de mais tempo foi aprovado - {company}"
        body = (
            f"{greeting}\n\n"
            f"Seu pedido de mais tempo de acesso ao {company} foi aprovado. Você pode entrar até {until_text}:\n"
            f"{base}/login\n\n"
            "Depois disso, o seu horário de acesso normal volta sozinho.\n"
        )
    else:
        subject = f"Seu pedido de mais tempo foi recusado - {company}"
        reason = f"Motivo: {note}\n\n" if note else ""
        body = (
            f"{greeting}\n\n"
            f"Seu pedido de mais tempo de acesso ao {company} foi recusado.\n\n"
            f"{reason}"
            "Se ainda precisar, fale com quem administra o sistema.\n"
        )
    _send(config, to_email, subject, body)


def send_reset_email(settings_row, to_email: str, to_name: str | None, token: str, expires_in_minutes: int) -> None:
    """Manda o link para a pessoa criar uma senha nova. O link vale por pouco tempo."""
    config, base = ensure_ready(settings_row)
    company = _company(settings_row)
    greeting = f"Olá, {to_name}." if to_name else "Olá."
    subject = f"Redefinição de senha - {company}"
    body = (
        f"{greeting}\n\n"
        f"Foi pedido um link para você criar uma senha nova no {company}. Acesse:\n"
        f"{base}/reset-password?token={token}\n\n"
        f"O link vale por {expires_in_minutes} minutos e só pode ser usado uma vez.\n"
        "Se você não esperava este e-mail, pode ignorá-lo: a sua senha atual continua valendo.\n"
    )
    _send(config, to_email, subject, body)

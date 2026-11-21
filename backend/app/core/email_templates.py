"""Os e-mails que o sistema escreve: texto padrao de cada um, troca de variaveis e o layout HTML com a marca.

Cada e-mail tem assunto, mensagem e (quando leva um link) o texto do botao. O administrador pode trocar esses tres
textos pela aba E-mail; o que ele nao trocar vale o padrao daqui. A mensagem e texto puro: paragrafos separados por linha
em branco e variaveis entre chaves, como {empresa}. O HTML e sempre montado por este modulo, com tudo escapado, entao o
texto digitado nunca vira HTML.

Regra das variaveis: um paragrafo que usa uma variavel vazia some do e-mail. E assim que "Motivo: {motivo}" desaparece
quando ninguem escreveu um motivo."""

import html
import re
from dataclasses import dataclass
from typing import Mapping, Optional

from sqlalchemy.orm import Session

from app.models.email_template import EmailTemplate

# Cinzas neutros do layout do e-mail (a cor da marca vem das configuracoes). Ficam aqui, uma vez, e o resto usa os nomes.
_INK = "#1f2937"  # paleta_guard: ignore
_MUTED = "#6b7280"  # paleta_guard: ignore
_PAGE_BG = "#f3f4f6"  # paleta_guard: ignore
_LINE = "#e5e7eb"  # paleta_guard: ignore
_SOFT_BG = "#f9fafb"  # paleta_guard: ignore

SUBJECT_MAX = 150
BODY_MAX = 3000
BUTTON_MAX = 40

_VARIABLE = re.compile(r"\{([a-z_]+)\}")
_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")


class TemplateError(ValueError):
    """Texto de e-mail invalido, com mensagem pronta para mostrar a quem editou."""


@dataclass(frozen=True)
class Variable:
    name: str
    label: str
    sample: str


@dataclass(frozen=True)
class TemplateDef:
    key: str
    label: str
    description: str
    variables: tuple[Variable, ...]
    subject: str
    body: str
    button: Optional[str]  # None: este e-mail nao leva botao


@dataclass(frozen=True)
class Effective:
    subject: str
    body: str
    button: Optional[str]


_GREETING = Variable("saudacao", "Saudação (\"Olá, Nome.\" ou só \"Olá.\")", "Olá, Maria da Silva.")
_COMPANY = Variable("empresa", "Nome da empresa", "BIHoster")
_GOOGLE = Variable("google", "Aviso do login com Google (some se o login com Google está desligado)", "Se preferir, entre com o botão do Google usando este mesmo e-mail.")

CATALOG: dict[str, TemplateDef] = {
    d.key: d
    for d in (
        TemplateDef(
            key="added",
            label="Adicionado ao sistema",
            description="Enviado a quem já tem conta quando alguém avisa que ela foi adicionada. O botão leva para a tela de entrada.",
            variables=(_GREETING, _COMPANY, _GOOGLE),
            subject="Você foi adicionado ao {empresa}",
            body=(
                "{saudacao}\n\n"
                "Você foi adicionado ao {empresa}. Para entrar, use o botão abaixo.\n\n"
                "{google}\n\n"
                "Se você não lembra a senha, use a opção de esqueci a senha na tela de entrada, "
                "ou peça a quem te adicionou para enviar um link de redefinição."
            ),
            button="Entrar",
        ),
        TemplateDef(
            key="invited",
            label="Convite para criar a conta",
            description="Enviado a quem ainda não tem conta, só um convite pendente. O botão leva para o cadastro.",
            variables=(_GREETING, _COMPANY, Variable("email", "E-mail da pessoa convidada", "maria@empresa.com"), _GOOGLE),
            subject="Você foi convidado para o {empresa}",
            body=(
                "{saudacao}\n\n"
                "Você foi convidado para o {empresa}. Para criar a sua conta, use o botão abaixo.\n\n"
                "Use este e-mail ({email}) no cadastro, para o acesso já vir liberado.\n\n"
                "{google}"
            ),
            button="Criar a minha conta",
        ),
        TemplateDef(
            key="reset",
            label="Redefinição de senha",
            description="Enviado quando alguém pede o link para a pessoa criar uma senha nova. O botão leva para criar a senha.",
            variables=(_GREETING, _COMPANY, Variable("minutos", "Quantos minutos o link vale", "60")),
            subject="Redefinição de senha - {empresa}",
            body=(
                "{saudacao}\n\n"
                "Foi pedido um link para você criar uma senha nova no {empresa}. Use o botão abaixo.\n\n"
                "O link vale por {minutos} minutos e só pode ser usado uma vez.\n\n"
                "Se você não esperava este e-mail, pode ignorá-lo: a sua senha atual continua valendo."
            ),
            button="Criar senha nova",
        ),
        TemplateDef(
            key="extension_request",
            label="Pedido de mais tempo (para quem libera)",
            description="Enviado a quem pode liberar acesso quando alguém fora do horário pede mais tempo. O botão leva para Gerenciar usuários.",
            variables=(
                _GREETING,
                _COMPANY,
                Variable("solicitante", "Nome de quem pediu", "João Pedro"),
                Variable("motivo", "Motivo escrito por quem pediu", "Preciso fechar o relatório do mês"),
            ),
            subject="Pedido de mais tempo de acesso - {empresa}",
            body=(
                "{saudacao}\n\n"
                "{solicitante} está fora do horário de acesso ao {empresa} e pediu mais tempo.\n\n"
                "Motivo: {motivo}\n\n"
                "Para aprovar ou recusar, use o botão abaixo."
            ),
            button="Ver os pedidos",
        ),
        TemplateDef(
            key="extension_approved",
            label="Horário liberado",
            description="Enviado a quem pediu mais tempo quando o pedido é aprovado. O botão leva para a tela de entrada.",
            variables=(
                _GREETING,
                _COMPANY,
                Variable("ate", "Até quando a liberação vale, com o fuso", "21/11 às 12:00 (horário de America/Sao_Paulo)"),
            ),
            subject="Seu pedido de mais tempo foi aprovado - {empresa}",
            body=(
                "{saudacao}\n\n"
                "Seu pedido de mais tempo de acesso ao {empresa} foi aprovado. Você pode entrar até {ate}.\n\n"
                "Depois disso, o seu horário de acesso normal volta sozinho."
            ),
            button="Entrar",
        ),
        TemplateDef(
            key="extension_denied",
            label="Pedido de mais tempo recusado",
            description="Enviado a quem pediu mais tempo quando o pedido é recusado. Não leva botão.",
            variables=(
                _GREETING,
                _COMPANY,
                Variable("motivo", "Motivo escrito por quem recusou (some se não escreveu)", "Fechamos o mês só amanhã"),
            ),
            subject="Seu pedido de mais tempo foi recusado - {empresa}",
            body=(
                "{saudacao}\n\n"
                "Seu pedido de mais tempo de acesso ao {empresa} foi recusado.\n\n"
                "Motivo: {motivo}\n\n"
                "Se ainda precisar, fale com quem administra o sistema."
            ),
            button=None,
        ),
        TemplateDef(
            key="subscription_paused",
            label="Assinatura pausada",
            description="Enviado a quem criou uma assinatura de relatório quando o sistema a pausa por falhas seguidas. Não leva botão.",
            variables=(
                _COMPANY,
                Variable("relatorio", "Nome do relatório", "Vendas do mês"),
                Variable("motivo", "O que deu errado no último envio", "O servidor recusou o usuário ou a senha."),
            ),
            subject="Assinatura pausada: {relatorio}",
            body=(
                "A assinatura do relatório {relatorio} foi pausada.\n\n"
                "Motivo: {motivo}\n\n"
                "Corrija o problema e ative a assinatura de novo na tela do relatório."
            ),
            button=None,
        ),
        TemplateDef(
            key="alert_triggered",
            label="Alerta de medida disparado",
            description=(
                "Enviado aos destinatários de um alerta quando a medida cruza o limite. Se o alerta tem um assunto próprio, "
                "ele vale no lugar do assunto daqui. Não leva botão."
            ),
            variables=(
                _COMPANY,
                Variable("relatorio", "Nome do relatório", "Vendas do mês"),
                Variable("medida", "Nome da medida acompanhada", "Total de vendas"),
                Variable("valor", "Valor da medida agora", "1250"),
                Variable("condicao", "A condição, em palavras", "maior que"),
                Variable("limite", "O limite configurado", "1000"),
                Variable("mensagem", "Mensagem escrita no alerta (some se não tem)", "Confira com o time comercial."),
                Variable("criador", "Quem configurou o alerta", "Maria da Silva"),
            ),
            subject="[Alerta] {medida} {condicao} {limite} - {relatorio}",
            body=(
                'O alerta configurado para o relatório "{relatorio}" foi disparado.\n\n'
                "Medida: {medida}\nValor: {valor}\nCondição: {condicao} {limite}\n\n"
                "{mensagem}\n\n"
                "Alerta configurado por {criador} no {empresa}."
            ),
            button=None,
        ),
        TemplateDef(
            key="test",
            label="E-mail de teste",
            description="Enviado pelo botão de teste do servidor de e-mail. Não leva botão.",
            variables=(_COMPANY,),
            subject="Teste de e-mail - {empresa}",
            body=(
                "Este é um e-mail de teste do {empresa}.\n\n"
                "Se você o recebeu, o servidor de e-mail está configurado corretamente."
            ),
            button=None,
        ),
    )
}


def get_def(key: str) -> TemplateDef:
    try:
        return CATALOG[key]
    except KeyError:
        raise TemplateError("Esse e-mail não existe.") from None


def used_variables(*texts: Optional[str]) -> set[str]:
    return {name for text in texts if text for name in _VARIABLE.findall(text)}


def validate_texts(key: str, subject: Optional[str], body: Optional[str], button: Optional[str]) -> None:
    """Confere tamanhos e variaveis. Variavel que o e-mail nao tem e erro, para um erro de digitacao nao sair no e-mail."""
    template = get_def(key)
    if subject and len(subject) > SUBJECT_MAX:
        raise TemplateError(f"O assunto pode ter até {SUBJECT_MAX} caracteres.")
    if body and len(body) > BODY_MAX:
        raise TemplateError(f"A mensagem pode ter até {BODY_MAX} caracteres.")
    if button and len(button) > BUTTON_MAX:
        raise TemplateError(f"O texto do botão pode ter até {BUTTON_MAX} caracteres.")
    allowed = {v.name for v in template.variables}
    unknown = sorted(used_variables(subject, body, button) - allowed)
    if unknown:
        listed = ", ".join("{" + name + "}" for name in unknown)
        available = ", ".join("{" + name + "}" for name in sorted(allowed))
        raise TemplateError(f"Variável que este e-mail não tem: {listed}. Use: {available}.")


def effective(db: Session, key: str) -> Effective:
    """O texto que vale hoje: o do administrador onde ele escreveu, o padrao no resto."""
    template = get_def(key)
    row = db.get(EmailTemplate, key)
    subject = (row.subject if row and row.subject else None) or template.subject
    body = (row.body if row and row.body else None) or template.body
    button = (row.button if row and row.button else None) or template.button
    return Effective(subject=subject, body=body, button=button if template.button is not None else None)


def draft(key: str, subject: Optional[str], body: Optional[str], button: Optional[str]) -> Effective:
    """O texto de um rascunho (ainda nao salvo): campo em branco vale o padrao."""
    template = get_def(key)
    validate_texts(key, subject, body, button)
    return Effective(
        subject=(subject or "").strip() or template.subject,
        body=(body or "").strip() or template.body,
        button=((button or "").strip() or template.button) if template.button is not None else None,
    )


def _substitute(text: str, values: Mapping[str, str]) -> str:
    return _VARIABLE.sub(lambda match: values.get(match.group(1), ""), text)


def render_subject(subject: str, values: Mapping[str, str]) -> str:
    return " ".join(_substitute(subject, values).split())


def render_paragraphs(body: str, values: Mapping[str, str]) -> list[str]:
    """Os paragrafos prontos. O que usa uma variavel vazia (ou que fica vazio) e omitido."""
    paragraphs: list[str] = []
    for raw in _PARAGRAPH_BREAK.split(body.replace("\r\n", "\n").strip()):
        names = _VARIABLE.findall(raw)
        if any(not (values.get(name) or "").strip() for name in names):
            continue
        text = _substitute(raw, values).strip()
        if text:
            paragraphs.append(text)
    return paragraphs


@dataclass(frozen=True)
class Brand:
    company: str
    primary: str
    logo_url: Optional[str]  # endereco completo (e-mail nao carrega imagem de caminho relativo)
    support_email: Optional[str]


def brand_from_settings(settings_row, base_url: Optional[str]) -> Brand:
    company = ((getattr(settings_row, "company_name", None) or "BIHoster").strip()) or "BIHoster"
    primary = getattr(settings_row, "primary_color", None) or "#1E3A6B"
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", primary):
        primary = "#1E3A6B"
    logo = getattr(settings_row, "logo_url", None)
    logo_url = f"{base_url}{logo}" if base_url and logo and logo.startswith("/") else None
    support = (getattr(settings_row, "support_email", None) or "").strip() or None
    return Brand(company=company, primary=primary, logo_url=logo_url, support_email=support)


def _text_color_on(background: str) -> str:
    """Branco ou quase preto, o que ficar mais legivel sobre a cor de fundo (luminancia relativa)."""
    red, green, blue = (int(background[i : i + 2], 16) / 255 for i in (1, 3, 5))
    luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    return _INK if luminance > 0.6 else "#ffffff"


def _paragraph_html(text: str) -> str:
    safe = html.escape(text, quote=True).replace("\n", "<br>")
    return f'<p style="margin:0 0 16px 0;">{safe}</p>'


def build_html(brand: Brand, subject: str, paragraphs: list[str], button_label: Optional[str], button_url: Optional[str]) -> str:
    """O e-mail em HTML: cartao branco com a marca no topo, o texto, o botao (se houver) e um rodape. Tabelas e estilo
    em linha, porque os programas de e-mail ignoram folha de estilo e quase todo recurso moderno."""
    font = "Arial, Helvetica, sans-serif"
    if brand.logo_url:
        header = f'<img src="{html.escape(brand.logo_url, quote=True)}" alt="{html.escape(brand.company, quote=True)}" height="40" style="display:block;height:40px;max-width:240px;border:0;">'
    else:
        header = f'<span style="font-family:{font};font-size:20px;font-weight:bold;color:{brand.primary};">{html.escape(brand.company)}</span>'

    content = "".join(_paragraph_html(text) for text in paragraphs)
    if button_label and button_url:
        content += (
            '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px 0;"><tr>'
            f'<td style="background:{brand.primary};border-radius:8px;">'
            f'<a href="{html.escape(button_url, quote=True)}" style="display:inline-block;padding:12px 24px;'
            f'font-family:{font};font-size:15px;font-weight:bold;color:{_text_color_on(brand.primary)};text-decoration:none;">'
            f"{html.escape(button_label)}</a></td></tr></table>"
            f'<p style="margin:16px 0 0 0;font-size:12px;color:{_MUTED};">Se o botão não abrir, copie este endereço no navegador:<br>'
            f'<span style="word-break:break-all;">{html.escape(button_url)}</span></p>'
        )

    footer = f"Mensagem automática do {html.escape(brand.company)}."
    if brand.support_email:
        footer += f" Dúvidas: {html.escape(brand.support_email)}."

    return (
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{html.escape(subject)}</title></head>"
        f'<body style="margin:0;padding:0;background:{_PAGE_BG};">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_PAGE_BG};padding:24px 12px;"><tr><td align="center">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        f'style="max-width:600px;width:100%;background:#ffffff;border:1px solid {_LINE};border-radius:12px;">'
        f'<tr><td style="padding:24px 28px 16px 28px;border-top:4px solid {brand.primary};border-radius:12px 12px 0 0;">{header}</td></tr>'
        f'<tr><td style="padding:8px 28px 24px 28px;font-family:{font};font-size:15px;line-height:1.6;color:{_INK};">{content}</td></tr>'
        f'<tr><td style="padding:16px 28px;background:{_SOFT_BG};border-top:1px solid {_LINE};border-radius:0 0 12px 12px;'
        f'font-family:{font};font-size:12px;line-height:1.5;color:{_MUTED};">{footer}</td></tr>'
        "</table></td></tr></table></body></html>"
    )


def build_text(paragraphs: list[str], button_label: Optional[str], button_url: Optional[str]) -> str:
    """A versao em texto puro (para quem le o e-mail sem HTML): os mesmos paragrafos e o link em uma linha."""
    parts = list(paragraphs)
    if button_label and button_url:
        parts.append(f"{button_label}: {button_url}")
    return "\n\n".join(parts) + "\n"


@dataclass(frozen=True)
class Rendered:
    subject: str
    text: str
    html: str


def render(effective_texts: Effective, values: Mapping[str, str], brand: Brand, button_url: Optional[str]) -> Rendered:
    subject = render_subject(effective_texts.subject, values)
    paragraphs = render_paragraphs(effective_texts.body, values)
    button_label = render_subject(effective_texts.button, values) if effective_texts.button else None
    return Rendered(
        subject=subject,
        text=build_text(paragraphs, button_label, button_url),
        html=build_html(brand, subject, paragraphs, button_label, button_url),
    )


def html_for_message(settings_row, base_url: Optional[str], subject: str, body: str) -> str:
    """O layout da marca em volta de um texto que ja vem pronto (o relatorio enviado por assinatura ou pelo botao de enviar,
    cujo assunto e mensagem cada envio escreve). Mesmos paragrafos do texto puro; sem botao."""
    brand = brand_from_settings(settings_row, base_url)
    paragraphs = [part.strip() for part in _PARAGRAPH_BREAK.split(body.replace("\r\n", "\n").strip()) if part.strip()]
    return build_html(brand, subject, paragraphs, None, None)


def sample_values(key: str, brand: Brand) -> dict[str, str]:
    """Os valores de exemplo, para a previa e o e-mail de teste."""
    values = {variable.name: variable.sample for variable in get_def(key).variables}
    values["empresa"] = brand.company
    return values

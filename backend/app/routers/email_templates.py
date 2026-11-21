"""Textos dos e-mails que o sistema envia: listar, editar, restaurar o padrao, ver a previa em HTML e mandar um teste.

So quem tem o item da aba E-mail ("sistema.email") mexe aqui. A previa e o teste usam valores de exemplo e a marca de
hoje (logo, cor e nome), e aceitam um rascunho ainda nao salvo."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core import email_templates
from app.core.access_deps import require_global_permission
from app.core.account_emails import site_base_url
from app.core.audit import log_action
from app.core.database import get_db
from app.core.email_sender import EmailError, disallowed_recipients, load_smtp_config, send_email
from app.core.rate_limit import limiter
from app.models.email_template import EmailTemplate
from app.models.settings import AppSettings
from app.models.user import User

router = APIRouter(prefix="/settings/email/templates", tags=["email-templates"])

# O caminho do botao de cada e-mail, so para o exemplo da previa (o e-mail de verdade monta o seu proprio)
_SAMPLE_LINKS = {
    "added": "/login",
    "invited": "/register",
    "reset": "/reset-password?token=EXEMPLO",
    "extension_request": "/users",
    "extension_approved": "/login",
}


class VariableOut(BaseModel):
    name: str
    label: str
    sample: str


class TemplateOut(BaseModel):
    key: str
    label: str
    description: str
    variables: list[VariableOut]
    has_button: bool
    default_subject: str
    default_body: str
    default_button: Optional[str] = None
    # O que o administrador escreveu; nulo onde vale o padrao
    subject: Optional[str] = None
    body: Optional[str] = None
    button: Optional[str] = None
    customized: bool = False


class TemplateIn(BaseModel):
    subject: Optional[str] = Field(default=None, max_length=email_templates.SUBJECT_MAX + 1000)
    body: Optional[str] = Field(default=None, max_length=email_templates.BODY_MAX + 1000)
    button: Optional[str] = Field(default=None, max_length=email_templates.BUTTON_MAX + 1000)


class PreviewOut(BaseModel):
    subject: str
    html: str


class TestIn(TemplateIn):
    to: EmailStr


def _settings_row(db: Session) -> AppSettings:
    row = db.query(AppSettings).filter(AppSettings.id == 1).first()
    if not row:
        row = AppSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _clean(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip()
    return value or None


def _to_out(db: Session, key: str) -> TemplateOut:
    template = email_templates.get_def(key)
    row = db.get(EmailTemplate, key)
    subject, body, button = (_clean(row.subject), _clean(row.body), _clean(row.button)) if row else (None, None, None)
    return TemplateOut(
        key=template.key,
        label=template.label,
        description=template.description,
        variables=[VariableOut(name=v.name, label=v.label, sample=v.sample) for v in template.variables],
        has_button=template.button is not None,
        default_subject=template.subject,
        default_body=template.body,
        default_button=template.button,
        subject=subject,
        body=body,
        button=button if template.button is not None else None,
        customized=any(value is not None for value in (subject, body, button)),
    )


def _template_or_404(key: str) -> None:
    try:
        email_templates.get_def(key)
    except email_templates.TemplateError:
        raise HTTPException(status_code=404, detail="Esse e-mail não existe.") from None


def _render_sample(db: Session, key: str, data: TemplateIn) -> tuple[email_templates.Rendered, AppSettings]:
    """O e-mail renderizado com os valores de exemplo, a partir do rascunho (campo em branco vale o padrao)."""
    row = _settings_row(db)
    try:
        texts = email_templates.draft(key, data.subject, data.body, data.button)
    except email_templates.TemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    base = site_base_url(row)
    brand = email_templates.brand_from_settings(row, base)
    path = _SAMPLE_LINKS.get(key)
    # Sem o endereco do site configurado o botao ainda aparece na previa, com um endereco de exemplo
    url = f"{base or 'https://seu-site.exemplo.com'}{path}" if path else None
    return email_templates.render(texts, email_templates.sample_values(key, brand), brand, url), row


@router.get("/", response_model=list[TemplateOut])
def list_templates(
    db: Session = Depends(get_db), _: User = Depends(require_global_permission("sistema.email"))
):
    return [_to_out(db, key) for key in email_templates.CATALOG]


@router.put("/{key}", response_model=TemplateOut)
def save_template(
    key: str,
    data: TemplateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("sistema.email")),
):
    """Grava o texto. Campo em branco volta ao padrao; se os tres ficam em branco, o e-mail volta todo ao padrao."""
    _template_or_404(key)
    subject, body, button = _clean(data.subject), _clean(data.body), _clean(data.button)
    try:
        email_templates.validate_texts(key, subject, body, button)
    except email_templates.TemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

    row = db.get(EmailTemplate, key)
    if subject is None and body is None and button is None:
        if row is not None:
            db.delete(row)
            db.commit()
    else:
        if row is None:
            row = EmailTemplate(key=key)
            db.add(row)
        row.subject, row.body, row.button = subject, body, button
        db.commit()
    log_action(db, action="update_email_template", entity="settings", user_id=current_user.id, details=key)
    return _to_out(db, key)


@router.delete("/{key}", response_model=TemplateOut)
def reset_template(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("sistema.email")),
):
    """Devolve o e-mail ao texto padrao."""
    _template_or_404(key)
    row = db.get(EmailTemplate, key)
    if row is not None:
        db.delete(row)
        db.commit()
        log_action(db, action="reset_email_template", entity="settings", user_id=current_user.id, details=key)
    return _to_out(db, key)


@router.post("/{key}/preview", response_model=PreviewOut)
def preview_template(
    key: str,
    data: TemplateIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_global_permission("sistema.email")),
):
    """O e-mail em HTML com valores de exemplo, a partir do que esta digitado (sem precisar salvar)."""
    _template_or_404(key)
    rendered, _row = _render_sample(db, key, data)
    return PreviewOut(subject=rendered.subject, html=rendered.html)


@router.post("/{key}/test")
@limiter.limit("5/minute")
def send_template_test(
    request: Request,
    key: str,
    data: TestIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("sistema.email")),
):
    """Manda o e-mail com valores de exemplo para o endereco pedido, para ver como chega de verdade."""
    _template_or_404(key)
    rendered, row = _render_sample(db, key, data)
    config = load_smtp_config(row)
    if config is None:
        raise HTTPException(status_code=400, detail="Configure o servidor e o remetente antes de testar.")
    recipient = str(data.to)
    if disallowed_recipients(row, [recipient]):
        raise HTTPException(status_code=400, detail="Esse e-mail está fora dos domínios permitidos.")
    try:
        send_email(config, [recipient], subject=f"[Teste] {rendered.subject}", body=rendered.text, html=rendered.html)
    except EmailError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    log_action(db, action="send_email_template_test", entity="settings", user_id=current_user.id, details=key)
    return {"detail": "E-mail de teste enviado."}

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.email_sender import EmailError, allowed_domains, disallowed_recipients, load_smtp_config, send_email
from app.core.rate_limit import limiter
from app.core.workspace_deps import require_platform_admin
from app.models.settings import AppSettings
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.email_settings import EmailSettingsOut, EmailSettingsUpdate, EmailStatus, EmailTestRequest

# Rotas proprias, so pra administradores (e o status pra qualquer pessoa logada): a rota de
# configuracoes gerais e publica, e servidor, usuario e senha de SMTP nunca podem sair por ela.
router = APIRouter(prefix="/settings/email", tags=["email-settings"])

_TEXT_FIELDS = ("smtp_host", "smtp_username", "smtp_from_name")


def _get_or_create_settings(db: Session) -> AppSettings:
    row = db.query(AppSettings).filter(AppSettings.id == 1).first()
    if not row:
        row = AppSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _to_out(row: AppSettings) -> EmailSettingsOut:
    return EmailSettingsOut(
        smtp_host=row.smtp_host,
        smtp_port=row.smtp_port,
        smtp_security=row.smtp_security,
        smtp_username=row.smtp_username,
        smtp_password_configured=bool(row.smtp_password),
        smtp_from_email=row.smtp_from_email,
        smtp_from_name=row.smtp_from_name,
        email_allowed_domains=row.email_allowed_domains,
        configured=load_smtp_config(row) is not None,
    )


@router.get("/", response_model=EmailSettingsOut)
def get_email_settings(db: Session = Depends(get_db), _: User = Depends(require_platform_admin)):
    return _to_out(_get_or_create_settings(db))


@router.get("/status", response_model=EmailStatus)
def get_email_status(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Quem esta logado so precisa saber se o envio por e-mail esta disponivel (pra mostrar ou
    esconder o botao), nunca os dados do servidor."""
    row = _get_or_create_settings(db)
    return EmailStatus(configured=load_smtp_config(row) is not None, allowed_domains=allowed_domains(row))


@router.put("/", response_model=EmailSettingsOut)
def update_email_settings(
    data: EmailSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    row = _get_or_create_settings(db)
    changed = data.model_dump(exclude_unset=True)

    password = changed.pop("smtp_password", None)
    for field, value in changed.items():
        if field in _TEXT_FIELDS and value == "":
            value = None
        setattr(row, field, value)
    if password is not None:
        row.smtp_password = password or None  # texto vazio apaga

    # Revalida o resultado final: usuario/senha ja salvos + seguranca "nenhuma" tambem e proibido
    if row.smtp_security == "none" and (row.smtp_username or row.smtp_password):
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Para usar usuario e senha escolha STARTTLS ou SSL: sem seguranca eles viajam em texto claro",
        )

    db.commit()
    db.refresh(row)

    updated = sorted(changed.keys() | ({"smtp_password"} if password is not None else set()))
    log_action(
        db,
        action="update_email_settings",
        entity="settings",
        user_id=current_user.id,
        details=", ".join(updated),  # so os nomes dos campos, nunca os valores
    )
    return _to_out(row)


@router.post("/test")
@limiter.limit("5/minute")
def send_test_email(
    request: Request,
    data: EmailTestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    row = _get_or_create_settings(db)
    config = load_smtp_config(row)
    if config is None:
        raise HTTPException(status_code=400, detail="Configure o servidor e o remetente antes de testar.")

    recipient = str(data.to)
    if disallowed_recipients(row, [recipient]):
        raise HTTPException(status_code=400, detail="Esse e-mail esta fora dos dominios permitidos.")

    try:
        send_email(
            config,
            [recipient],
            subject=f"Teste de e-mail - {row.company_name}",
            body=(
                f"Este e um e-mail de teste do {row.company_name}.\n\n"
                "Se voce o recebeu, o servidor de e-mail esta configurado corretamente."
            ),
        )
    except EmailError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    log_action(db, action="send_test_email", entity="settings", user_id=current_user.id, details="1 destinatario")
    return {"detail": "E-mail de teste enviado."}

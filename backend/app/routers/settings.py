import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.workspace_deps import require_platform_admin
from app.models.settings import AppSettings
from app.models.user import User
from app.models.workspace import Group, GroupMember
from app.schemas.settings import SettingsOut, SettingsUpdate

SECURITY_SENSITIVE_FIELDS = {
    "allow_registration",
    "google_oauth_enabled",
    "google_client_id",
    "google_client_secret",
    "google_allowed_domains",
}

router = APIRouter(prefix="/settings", tags=["settings"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "static" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
# SVG de proposito fora da lista -- pode conter <script>/on* embutido e e servido como arquivo
# estatico da propria origem do app (/static/uploads/...), o que da XSS se alguem abrir o
# arquivo direto ou algum componente carregar via <object>/<embed> sem sandbox.
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/x-icon", "image/vnd.microsoft.icon"}
MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024  # 5MB


def _get_or_create_settings(db: Session) -> AppSettings:
    settings_row = db.query(AppSettings).filter(AppSettings.id == 1).first()
    if not settings_row:
        settings_row = AppSettings(id=1)
        db.add(settings_row)
        db.commit()
        db.refresh(settings_row)
    return settings_row


def _to_out(settings_row: AppSettings) -> SettingsOut:
    """Nunca inclui os secrets na resposta -- so um booleano dizendo se ja foram configurados."""
    return SettingsOut(
        company_name=settings_row.company_name,
        primary_color=settings_row.primary_color,
        secondary_color=settings_row.secondary_color,
        logo_url=settings_row.logo_url,
        favicon_url=settings_row.favicon_url,
        login_image_url=settings_row.login_image_url,
        login_layout=settings_row.login_layout,
        timezone=settings_row.timezone,
        site_url=settings_row.site_url,
        support_email=settings_row.support_email,
        force_https=settings_row.force_https,
        default_workspace_id=settings_row.default_workspace_id,
        allow_registration=settings_row.allow_registration,
        google_oauth_enabled=settings_row.google_oauth_enabled,
        google_client_id=settings_row.google_client_id,
        google_client_secret_configured=bool(settings_row.google_client_secret),
        google_allowed_domains=settings_row.google_allowed_domains,
    )


@router.get("/", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    """Publico -- a marca (logo/nome) precisa aparecer ate na tela de login, antes de qualquer auth."""
    return _to_out(_get_or_create_settings(db))


@router.put("/", response_model=SettingsOut)
def update_settings(
    data: SettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    settings_row = _get_or_create_settings(db)
    changed_fields = data.model_dump(exclude_unset=True)

    # Evita o admin se trancar pra sempre: se ele se cadastrou via Google (senha inutilizavel)
    # e e o unico administrador da plataforma, nao deixa desativar o login com Google --
    # sem isso, ninguem mais poderia gerar um link de redefinicao pra ele.
    if changed_fields.get("google_oauth_enabled") is False and current_user.registered_via == "google":
        admin_group = db.query(Group).filter(Group.is_admin_group.is_(True)).first()
        admin_count = (
            db.query(GroupMember).filter(GroupMember.group_id == admin_group.id).count() if admin_group else 0
        )
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Voce se cadastrou via Google e e o unico administrador -- desativar o login "
                    "com Google agora te trancaria pra fora (sua senha atual e inutilizavel). "
                    "Adicione outro administrador antes de desativar."
                ),
            )

    for field, value in changed_fields.items():
        setattr(settings_row, field, value)
    db.commit()
    db.refresh(settings_row)

    sensitive_changed = SECURITY_SENSITIVE_FIELDS & changed_fields.keys()
    if sensitive_changed:
        log_action(
            db,
            action="update_auth_settings",
            entity="settings",
            user_id=current_user.id,
            details=", ".join(sorted(sensitive_changed)),
        )

    return _to_out(settings_row)


def _save_upload(file: UploadFile) -> str:
    """Sincrona de proposito -- os endpoints que chamam essa funcao sao `def` (nao `async def`),
    entao o FastAPI roda tudo (leitura do arquivo, escrita em disco, commits) numa threadpool
    em vez de bloquear o event loop, diferente de uma versao async com I/O sincrono dentro."""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Formato de imagem nao suportado")

    extension = Path(file.filename or "").suffix or ".png"
    filename = f"{uuid.uuid4().hex}{extension}"
    destination = UPLOAD_DIR / filename

    # Le 1 byte a mais do limite em vez do arquivo inteiro -- um upload de varios GB nao aloca
    # tudo em memoria antes de ser rejeitado (o limite so barrava DEPOIS da leitura completa).
    contents = file.file.read(MAX_UPLOAD_SIZE_BYTES + 1)
    if len(contents) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Imagem maior que o limite de 5MB")
    destination.write_bytes(contents)

    return f"/static/uploads/{filename}"


def _delete_upload_if_exists(url: str | None) -> None:
    """Apaga o arquivo antigo do disco ao trocar ou remover logo/favicon/imagem de login --
    sem isso, cada upload deixava o arquivo anterior orfao em static/uploads/ para sempre."""
    if not url or not url.startswith("/static/uploads/"):
        return
    path = UPLOAD_DIR / url.removeprefix("/static/uploads/")
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


@router.post("/logo", response_model=SettingsOut)
def upload_logo(
    file: UploadFile,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    settings_row = _get_or_create_settings(db)
    old_url = settings_row.logo_url
    settings_row.logo_url = _save_upload(file)
    db.commit()
    db.refresh(settings_row)
    _delete_upload_if_exists(old_url)
    return _to_out(settings_row)


@router.delete("/logo", response_model=SettingsOut)
def remove_logo(
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    settings_row = _get_or_create_settings(db)
    old_url = settings_row.logo_url
    settings_row.logo_url = None
    db.commit()
    _delete_upload_if_exists(old_url)
    db.refresh(settings_row)
    return _to_out(settings_row)


@router.post("/favicon", response_model=SettingsOut)
def upload_favicon(
    file: UploadFile,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    settings_row = _get_or_create_settings(db)
    old_url = settings_row.favicon_url
    settings_row.favicon_url = _save_upload(file)
    db.commit()
    db.refresh(settings_row)
    _delete_upload_if_exists(old_url)
    return _to_out(settings_row)


@router.delete("/favicon", response_model=SettingsOut)
def remove_favicon(
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    settings_row = _get_or_create_settings(db)
    old_url = settings_row.favicon_url
    settings_row.favicon_url = None
    db.commit()
    _delete_upload_if_exists(old_url)
    db.refresh(settings_row)
    return _to_out(settings_row)


@router.post("/login-image", response_model=SettingsOut)
def upload_login_image(
    file: UploadFile,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    settings_row = _get_or_create_settings(db)
    old_url = settings_row.login_image_url
    settings_row.login_image_url = _save_upload(file)
    db.commit()
    db.refresh(settings_row)
    _delete_upload_if_exists(old_url)
    return _to_out(settings_row)


@router.delete("/login-image", response_model=SettingsOut)
def remove_login_image(
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    settings_row = _get_or_create_settings(db)
    old_url = settings_row.login_image_url
    settings_row.login_image_url = None
    db.commit()
    _delete_upload_if_exists(old_url)
    db.refresh(settings_row)
    return _to_out(settings_row)

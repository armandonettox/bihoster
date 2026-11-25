import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.access_deps import require_any_global_permission, require_global_permission
from app.core.access_engine import effective_access
from app.models.settings import AppSettings
from app.models.user import User
from app.models.workspace import Group, GroupMember, Workspace
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
        single_collection_redirect=bool(settings_row.single_collection_redirect),
        default_workspace_id=settings_row.default_workspace_id,
        not_found_title=settings_row.not_found_title,
        not_found_message=settings_row.not_found_message,
        not_found_button=settings_row.not_found_button,
        error_title=settings_row.error_title,
        error_message=settings_row.error_message,
        error_button=settings_row.error_button,
        outside_hours_title=settings_row.outside_hours_title,
        outside_hours_message=settings_row.outside_hours_message,
        outside_hours_button=settings_row.outside_hours_button,
        no_access_title=settings_row.no_access_title,
        no_access_message=settings_row.no_access_message,
        no_access_button=settings_row.no_access_button,
        allow_registration=settings_row.allow_registration,
        google_oauth_enabled=settings_row.google_oauth_enabled,
        google_client_id=settings_row.google_client_id,
        google_client_secret_configured=bool(settings_row.google_client_secret),
        google_allowed_domains=settings_row.google_allowed_domains,
        cache_warmup_enabled=bool(settings_row.cache_warmup_enabled) if settings_row.cache_warmup_enabled is not None else True,
        cache_warmup_interval_seconds=settings_row.cache_warmup_interval_seconds if settings_row.cache_warmup_interval_seconds is not None else 240,
        # Nulo = nunca mexeram: vale o comportamento de sempre (a pre-carga ja rodava), entao so desliga quem escolhe
        embed_preload_enabled=settings_row.embed_preload_enabled is not False,
        cache_warmup_only_recent=bool(settings_row.cache_warmup_only_recent),
        cache_warmup_recent_hours=settings_row.cache_warmup_recent_hours or 72,
        capacity_control_enabled=bool(settings_row.capacity_control_enabled),
    )


# Cada campo de configuracao pertence a uma aba da Administracao; quem muda o campo precisa ter o item dela.
# Campo que nao esta aqui so o administrador da plataforma muda.
FIELD_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "company_name": ("sistema.geral", "sistema.marca"),
    "timezone": ("sistema.geral",),
    "site_url": ("sistema.geral",),
    "support_email": ("sistema.geral",),
    "force_https": ("sistema.geral",),
    "single_collection_redirect": ("sistema.geral",),
    "default_workspace_id": ("sistema.geral",),
    "primary_color": ("sistema.marca",),
    "secondary_color": ("sistema.marca",),
    "login_layout": ("sistema.marca",),
    "not_found_title": ("sistema.marca",),
    "not_found_message": ("sistema.marca",),
    "not_found_button": ("sistema.marca",),
    "error_title": ("sistema.marca",),
    "error_message": ("sistema.marca",),
    "error_button": ("sistema.marca",),
    "outside_hours_title": ("sistema.marca",),
    "outside_hours_message": ("sistema.marca",),
    "outside_hours_button": ("sistema.marca",),
    "no_access_title": ("sistema.marca",),
    "no_access_message": ("sistema.marca",),
    "no_access_button": ("sistema.marca",),
    "allow_registration": ("sistema.autenticacao",),
    "google_oauth_enabled": ("sistema.autenticacao",),
    "google_client_id": ("sistema.autenticacao",),
    "google_client_secret": ("sistema.autenticacao",),
    "google_allowed_domains": ("sistema.autenticacao",),
    "cache_warmup_enabled": ("sistema.cache",),
    "cache_warmup_interval_seconds": ("sistema.cache",),
    "embed_preload_enabled": ("sistema.cache",),
    "cache_warmup_only_recent": ("sistema.cache",),
    "cache_warmup_recent_hours": ("sistema.cache",),
    "capacity_control_enabled": ("sistema.cache",),
}


def _check_fields_allowed(db: Session, user: User, fields) -> None:
    access = effective_access(db, user.id)
    if access.is_admin:
        return
    denied = [
        field
        for field in fields
        if not any(access.has_global(key) for key in FIELD_PERMISSIONS.get(field, ()))
    ]
    if denied:
        raise HTTPException(status_code=403, detail="Voce nao tem permissao para mudar: " + ", ".join(sorted(denied)))


@router.get("/", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    """Publico -- a marca (logo/nome) precisa aparecer ate na tela de login, antes de qualquer auth."""
    return _to_out(_get_or_create_settings(db))


@router.put("/", response_model=SettingsOut)
def update_settings(
    data: SettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_global_permission("sistema.geral", "sistema.marca", "sistema.autenticacao", "sistema.cache")),
):
    settings_row = _get_or_create_settings(db)
    changed_fields = data.model_dump(exclude_unset=True)
    _check_fields_allowed(db, current_user, changed_fields.keys())

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

    # A colecao padrao precisa existir: um id solto deixava o redirecionamento da home apontando
    # pra uma colecao inexistente (404/403 na tela inicial de todo mundo).
    default_workspace_id = changed_fields.get("default_workspace_id")
    if default_workspace_id is not None and not db.query(Workspace).filter(Workspace.id == default_workspace_id, Workspace.system_key.is_(None)).first():
        raise HTTPException(status_code=400, detail="A colecao padrao escolhida nao existe")

    cache_fields_changed = {"cache_warmup_enabled", "cache_warmup_interval_seconds", "cache_warmup_only_recent", "cache_warmup_recent_hours"} & changed_fields.keys()

    for field, value in changed_fields.items():
        setattr(settings_row, field, value)
    db.commit()
    db.refresh(settings_row)

    if cache_fields_changed:
        from app.core import cache_warmup
        cache_warmup.restart()

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


@router.get("/cache/stats")
def get_cache_stats(_: User = Depends(require_global_permission("sistema.cache"))):
    """Tamanho atual dos caches de embed e resultado do ultimo ciclo de aquecimento."""
    from app.core import cache_warmup
    return cache_warmup.get_stats()


@router.delete("/cache")
def reset_cache(_: User = Depends(require_global_permission("sistema.cache"))):
    """Limpa todos os caches de embed. O proximo acesso a cada relatorio gera um token novo."""
    from app.core import cache_warmup
    cache_warmup.clear_all()
    return cache_warmup.get_stats()


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
    _=Depends(require_global_permission("sistema.marca")),
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
    _=Depends(require_global_permission("sistema.marca")),
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
    _=Depends(require_global_permission("sistema.marca")),
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
    _=Depends(require_global_permission("sistema.marca")),
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
    _=Depends(require_global_permission("sistema.marca")),
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
    _=Depends(require_global_permission("sistema.marca")),
):
    settings_row = _get_or_create_settings(db)
    old_url = settings_row.login_image_url
    settings_row.login_image_url = None
    db.commit()
    _delete_upload_if_exists(old_url)
    db.refresh(settings_row)
    return _to_out(settings_row)

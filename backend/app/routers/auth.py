from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password_constant_time,
)
from app.models.invite import GroupInvite
from app.models.password_reset import PasswordResetToken
from app.models.settings import AppSettings
from app.models.user import User
from app.models.workspace import GroupMember
from app.schemas.user import GoogleLogin, ResetPassword, Token, UserCreate, UserLogin, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def _get_app_settings(db: Session) -> AppSettings:
    settings_row = db.query(AppSettings).filter(AppSettings.id == 1).first()
    if not settings_row:
        settings_row = AppSettings(id=1)
        db.add(settings_row)
        db.commit()
        db.refresh(settings_row)
    return settings_row


def _consume_invites(db: Session, user: User) -> None:
    """Ao criar a conta, entra automaticamente nos grupos onde ja havia convite pendente pro email."""
    invites = db.query(GroupInvite).filter(GroupInvite.email == user.email).all()
    for invite in invites:
        exists = db.query(GroupMember).filter(GroupMember.group_id == invite.group_id, GroupMember.user_id == user.id).first()
        if not exists:
            db.add(GroupMember(group_id=invite.group_id, user_id=user.id))
        db.delete(invite)
    if invites:
        db.commit()


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def register(request: Request, data: UserCreate, db: Session = Depends(get_db)):
    if not _get_app_settings(db).allow_registration:
        raise HTTPException(status_code=403, detail="Criacao de conta esta desabilitada nesta instancia")

    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email ja cadastrado")

    # import tardio evita ciclo com workspace_deps (que importa get_current_user daqui)
    from app.core.workspace_deps import add_user_to_admin_group, admin_group_lock, ensure_user_in_default_group

    # Lock em volta da checagem "sou o primeiro usuario?" + criacao -- sem isso, dois registros
    # concorrentes podem ambos ler count()==0 antes de qualquer commit e virar admin os dois.
    with admin_group_lock:
        is_first_user = db.query(User).count() == 0

        user = User(
            name=data.name,
            email=data.email,
            hashed_password=hash_password(data.password),
        )
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            # Duas requisicoes de registro com o mesmo email passaram pela checagem acima
            # antes de qualquer commit -- a constraint unica pega a corrida em vez de dar 500.
            db.rollback()
            raise HTTPException(status_code=400, detail="Email ja cadastrado")
        db.refresh(user)

        if is_first_user:
            add_user_to_admin_group(db, user.id)

    ensure_user_in_default_group(db, user.id)
    _consume_invites(db, user)

    log_action(db, action="register", entity="user", user_id=user.id, entity_id=user.id)

    from app.core.workspace_deps import is_platform_admin

    return UserOut(id=user.id, name=user.name, email=user.email, is_platform_admin=is_platform_admin(db, user.id))


@router.post("/login", response_model=Token)
@limiter.limit("10/minute")
def login(request: Request, data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()

    if user and user.locked_until:
        locked_until = user.locked_until
        if locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=timezone.utc)
        if locked_until > datetime.now(timezone.utc):
            log_action(db, action="login_blocked", entity="user", user_id=user.id, entity_id=user.id)
            raise HTTPException(status_code=423, detail="Conta bloqueada temporariamente por excesso de tentativas")

    # Roda o bcrypt mesmo quando o usuario nao existe (contra hash "dummy") -- senao a resposta
    # de email inexistente e quase instantanea enquanto senha errada leva o tempo cheio do
    # bcrypt, dando pra enumerar emails cadastrados so medindo o tempo de resposta.
    password_ok = verify_password_constant_time(data.password, user.hashed_password if user else None)
    if not user or not password_ok:
        if user:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= settings.max_failed_login_attempts:
                user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=settings.account_lock_minutes)
                log_action(db, action="account_locked", entity="user", user_id=user.id, entity_id=user.id)
            db.commit()
        raise HTTPException(status_code=401, detail="Email ou senha invalidos")

    user.failed_login_attempts = 0
    user.locked_until = None
    db.commit()

    log_action(db, action="login", entity="user", user_id=user.id, entity_id=user.id)

    token = create_access_token(subject=str(user.id))
    return Token(access_token=token)


@router.post("/google", response_model=Token)
@limiter.limit("10/minute")
def login_with_google(request: Request, data: GoogleLogin, db: Session = Depends(get_db)):
    settings_row = _get_app_settings(db)
    if not settings_row.google_oauth_enabled or not settings_row.google_client_id:
        raise HTTPException(status_code=403, detail="Login com Google esta desabilitado nesta instancia")

    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    try:
        payload = google_id_token.verify_oauth2_token(
            data.id_token, google_requests.Request(), settings_row.google_client_id
        )
    except ValueError:
        raise HTTPException(status_code=401, detail="Token do Google invalido")

    email = payload.get("email")
    name = payload.get("name") or email
    if not email:
        raise HTTPException(status_code=401, detail="Token do Google sem email")
    email = email.strip().lower()

    allowed_domains = [d.strip() for d in (settings_row.google_allowed_domains or "").split(",") if d.strip()]
    domain = email.rsplit("@", 1)[-1]
    domain_explicitly_allowed = bool(allowed_domains) and domain in allowed_domains
    if allowed_domains and not domain_explicitly_allowed:
        raise HTTPException(
            status_code=403,
            detail="Esse dominio de email nao tem permissao para entrar com Google nesta instancia",
        )

    user = db.query(User).filter(User.email == email).first()
    if not user:
        # `allow_registration` desligado bloqueia autocadastro por email/senha, mas nao deve
        # bloquear a primeira entrada de um dominio que o admin explicitamente liberou pra
        # Google em `google_allowed_domains` -- foi adicionado exatamente pra isso.
        if not settings_row.allow_registration and not domain_explicitly_allowed:
            raise HTTPException(status_code=403, detail="Criacao de conta esta desabilitada nesta instancia")
        import uuid

        from app.core.workspace_deps import add_user_to_admin_group, admin_group_lock, ensure_user_in_default_group

        with admin_group_lock:
            user = User(name=name, email=email, hashed_password=hash_password(uuid.uuid4().hex), registered_via="google")
            is_first_user = db.query(User).count() == 0
            db.add(user)
            try:
                db.commit()
            except IntegrityError:
                # Duas requisicoes de login com Google pro mesmo email (ex: dois cliques rapidos)
                # passaram pela checagem acima antes de qualquer commit.
                db.rollback()
                user = db.query(User).filter(User.email == email).first()
                if not user:
                    raise HTTPException(status_code=400, detail="Email ja cadastrado")
            else:
                db.refresh(user)

            if is_first_user:
                add_user_to_admin_group(db, user.id)

        ensure_user_in_default_group(db, user.id)
        _consume_invites(db, user)
        log_action(db, action="register", entity="user", user_id=user.id, entity_id=user.id, details="google")

    log_action(db, action="login", entity="user", user_id=user.id, entity_id=user.id, details="google")
    token = create_access_token(subject=str(user.id))
    return Token(access_token=token)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/minute")
def reset_password(request: Request, data: ResetPassword, db: Session = Depends(get_db)):
    # Mensagem generica pros tres casos (inexistente/usado/expirado) -- nao da pra distinguir
    # de fora se um token chegou a ser valido algum dia so pelo erro retornado.
    invalid_link_error = HTTPException(status_code=400, detail="Link de redefinicao invalido ou expirado")

    reset_token = db.query(PasswordResetToken).filter(PasswordResetToken.token == data.token).first()
    if not reset_token or reset_token.used:
        raise invalid_link_error

    expires_at = reset_token.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise invalid_link_error

    user = db.query(User).get(reset_token.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")

    user.hashed_password = hash_password(data.new_password)
    user.failed_login_attempts = 0
    user.locked_until = None
    reset_token.used = True
    db.commit()

    log_action(db, action="reset_password", entity="user", user_id=user.id, entity_id=user.id)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Token invalido")

    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Usuario nao encontrado")
    if user.locked_until:
        locked_until = user.locked_until
        if locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=timezone.utc)
        if locked_until > datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Conta bloqueada")
    return user


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.core.workspace_deps import is_platform_admin

    return UserOut(
        id=current_user.id,
        name=current_user.name,
        email=current_user.email,
        is_platform_admin=is_platform_admin(db, current_user.id),
    )

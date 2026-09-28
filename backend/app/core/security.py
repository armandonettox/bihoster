from datetime import datetime, timedelta, timezone

import bcrypt
from jose import jwt

from app.core.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# Hash valido (nao corresponde a nenhuma senha real) usado so pra gastar o mesmo tempo de bcrypt
# quando o email de login nao existe -- sem isso, "email nao existe" responde quase instantaneo
# e "email existe mas senha errada" leva o tempo cheio do bcrypt, dando pra enumerar emails
# cadastrados so medindo o tempo de resposta do /auth/login.
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password-for-constant-time-login", bcrypt.gensalt()).decode("utf-8")


def verify_password_constant_time(plain_password: str, hashed_password: str | None) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), (hashed_password or _DUMMY_HASH).encode("utf-8"))


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])

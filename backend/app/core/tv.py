"""Regras do Modo TV que nao dependem de rota: o codigo de acesso que muda com o tempo, a conexao da TV (token) e as
tentativas erradas.

O codigo funciona como a dupla autenticacao: 6 digitos tirados de um segredo da TV e da hora, que mudam a cada
`CODE_STEP_SECONDS`. Aceita o codigo da janela atual e o da anterior, para quem digitou na virada nao ser barrado.
A TV conectada guarda um token assinado, sem nada no banco: ele vale ate `exp` (ou para sempre) e morre quando a TV
e desconectada ou o link e trocado (`sessions_revoked_at`)."""

import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt

from app.core.config import settings
from app.models.tv import Tv

CODE_STEP_SECONDS = 300
CODE_DIGITS = 6
TOKEN_KIND = "tv"
# Errou o codigo tantas vezes nessa TV, em qualquer origem, e ela fica trancada por um tempo
MAX_FAILURES = 10
FAILURE_WINDOW_SECONDS = 10 * 60
MIN_SESSION_HOURS = 1
MAX_SESSION_HOURS = 24 * 365

_failures: dict[int, list[float]] = {}


def new_secret() -> str:
    return secrets.token_urlsafe(32)


def _code_for(code_secret: str, window: int) -> str:
    digest = hmac.new(code_secret.encode("utf-8"), str(window).encode("ascii"), hashlib.sha256).digest()
    number = int.from_bytes(digest[:4], "big") % (10**CODE_DIGITS)
    return str(number).zfill(CODE_DIGITS)


def current_code(tv: Tv, now: Optional[float] = None) -> tuple[str, int]:
    """O codigo de agora e quantos segundos faltam para ele mudar."""
    moment = time.time() if now is None else now
    window = int(moment // CODE_STEP_SECONDS)
    return _code_for(tv.code_secret, window), int((window + 1) * CODE_STEP_SECONDS - moment)


def code_is_valid(tv: Tv, typed: str, now: Optional[float] = None) -> bool:
    moment = time.time() if now is None else now
    window = int(moment // CODE_STEP_SECONDS)
    typed = "".join(ch for ch in (typed or "") if ch.isdigit())
    return any(hmac.compare_digest(typed, _code_for(tv.code_secret, w)) for w in (window, window - 1))


def is_locked(tv_id: int, now: Optional[float] = None) -> bool:
    moment = time.time() if now is None else now
    recent = [t for t in _failures.get(tv_id, []) if moment - t < FAILURE_WINDOW_SECONDS]
    _failures[tv_id] = recent
    return len(recent) >= MAX_FAILURES


def register_failure(tv_id: int, now: Optional[float] = None) -> None:
    _failures.setdefault(tv_id, []).append(time.time() if now is None else now)


def clear_failures(tv_id: int) -> None:
    _failures.pop(tv_id, None)


def create_device_token(tv: Tv) -> tuple[str, Optional[datetime]]:
    """Token da TV conectada e quando ele vence (vazio = nunca, a TV fica conectada para sempre)."""
    now = datetime.now(timezone.utc)
    payload = {"kind": TOKEN_KIND, "tv": tv.id, "iat_ms": int(now.timestamp() * 1000)}
    expires_at = None
    if tv.session_hours:
        expires_at = now + timedelta(hours=tv.session_hours)
        payload["exp"] = expires_at
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm), expires_at


def read_device_token(token: str) -> Optional[dict]:
    """O conteudo do token, ou None se for invalido, vencido ou de outro tipo (um token de pessoa nao serve aqui)."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
    if payload.get("kind") != TOKEN_KIND or not isinstance(payload.get("tv"), int):
        return None
    return payload


def token_is_revoked(tv: Tv, payload: dict) -> bool:
    revoked_at = tv.sessions_revoked_at
    if revoked_at is None:
        return False
    if revoked_at.tzinfo is None:
        revoked_at = revoked_at.replace(tzinfo=timezone.utc)
    return int(payload.get("iat_ms", 0)) <= int(revoked_at.timestamp() * 1000)


def youtube_video_id(url: str) -> Optional[str]:
    """O id do video de um link do YouTube (watch, youtu.be, embed, shorts ou live); None se nao for um link valido."""
    from urllib.parse import parse_qs, urlparse

    try:
        parsed = urlparse((url or "").strip())
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    candidate: Optional[str] = None
    if host == "youtu.be":
        candidate = parsed.path.strip("/").split("/")[0]
    elif host in ("youtube.com", "music.youtube.com", "youtube-nocookie.com"):
        parts = [p for p in parsed.path.split("/") if p]
        if parsed.path.startswith("/watch"):
            candidate = (parse_qs(parsed.query).get("v") or [""])[0]
        elif len(parts) >= 2 and parts[0] in ("embed", "shorts", "live", "v"):
            candidate = parts[1]
    if candidate and len(candidate) == 11 and all(ch.isalnum() or ch in "-_" for ch in candidate):
        return candidate
    return None


def move_old_tv_reports(db) -> int:
    """O modo TV antigo (relatorio marcado como TV dentro da colecao) acabou: o relatorio passa para a secao Paineis.
    Roda em todo boot e e idempotente. Devolve quantos relatorios mudaram."""
    from app.models.report import Report

    moved = db.query(Report).filter(Report.display_type == "tv").update({Report.display_type: "painel"})
    db.commit()
    return moved

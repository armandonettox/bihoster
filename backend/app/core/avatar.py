"""Foto de perfil vinda do Google: baixa, confere e guarda no disco do servidor."""

import logging
import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "static" / "uploads"
MAX_AVATAR_BYTES = 2 * 1024 * 1024
ALLOWED_HOST_SUFFIXES = (".googleusercontent.com",)


def _image_extension(data: bytes) -> str | None:
    """Descobre o formato pelo conteudo, nao pelo que o servidor remoto diz."""
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


def is_allowed_picture_url(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and host.endswith(ALLOWED_HOST_SUFFIXES)


def delete_avatar(url: str | None) -> None:
    if not url or not url.startswith("/static/uploads/avatar-"):
        return
    try:
        (UPLOAD_DIR / url.removeprefix("/static/uploads/")).unlink(missing_ok=True)
    except OSError:
        pass


def download_avatar(picture: str | None, user_id: int, old_url: str | None) -> str | None:
    """Devolve a nova URL local da foto, ou None se nao deu (sem foto, host fora do Google,
    arquivo grande demais ou que nao e imagem, falha de rede). Quem chama mantem a foto
    anterior nesses casos: o login nunca falha por causa da foto."""
    if not picture or not is_allowed_picture_url(picture):
        return None
    try:
        data = b""
        # Sem seguir redirecionamento: o host ja foi conferido e nao queremos sair dele
        with httpx.stream("GET", picture, timeout=5.0, follow_redirects=False) as resp:
            if resp.status_code != 200:
                return None
            for chunk in resp.iter_bytes():
                data += chunk
                if len(data) > MAX_AVATAR_BYTES:
                    return None
    except httpx.HTTPError as exc:
        logger.warning("Nao foi possivel baixar a foto do Google: %s", exc)
        return None

    extension = _image_extension(data)
    if not extension:
        return None

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"avatar-{user_id}-{uuid.uuid4().hex[:10]}{extension}"
    (UPLOAD_DIR / filename).write_bytes(data)
    delete_avatar(old_url)
    return f"/static/uploads/{filename}"

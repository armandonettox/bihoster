import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional, TypeVar

import httpx
from pydantic import BaseModel

from app.core.config import settings

GITHUB_REPO = "armandonettox/bihoster"
GITHUB_API_BASE = f"https://api.github.com/repos/{GITHUB_REPO}"
# Sem autenticacao -- endpoint publico de um repo publico, rate limit de 60 req/h por IP.
_HTTP_TIMEOUT = 10.0

# Cada abertura da aba Atualizacoes (e cada usuario admin) consultava o GitHub de novo, gastando
# o limite de 60 req/h por IP. Guarda a resposta por alguns minutos; falhas nao sao cacheadas.
_RELEASE_CACHE_TTL_SECONDS = 600.0
_release_cache: dict[str, tuple[float, object]] = {}

# Uma atualizacao reinicia os containers; duas ao mesmo tempo (duplo clique, dois admins)
# disputariam o mesmo `docker compose pull && up -d`. A trava expira sozinha caso fique presa.
APPLY_LOCK_STALE_SECONDS = 600
# A aba mostra os logs completos de cada atualizacao; sem limite a resposta cresce para sempre
MAX_UPDATE_LOGS = 10
MAX_LOG_CHARS = 20_000

_T = TypeVar("_T")


class UpdateAlreadyRunning(Exception):
    """Ja existe uma atualizacao em andamento neste host."""


def clear_release_cache() -> None:
    _release_cache.clear()


def _cached(key: str, fetch: Callable[[], _T], force: bool) -> _T:
    now = time.monotonic()
    if not force:
        hit = _release_cache.get(key)
        if hit and now - hit[0] < _RELEASE_CACHE_TTL_SECONDS:
            return hit[1]  # type: ignore[return-value]
    value = fetch()
    _release_cache[key] = (now, value)
    return value


class ReleaseInfo(BaseModel):
    version: str
    name: str
    changelog: str
    published_at: Optional[str]
    is_current: bool = False


def _deploy_dir() -> Path:
    """Diretorio onde o docker-compose.yml do host foi montado dentro do backend (ver
    docker-compose.yml, volume `.:/deploy:ro`) -- e onde os comandos `docker compose` rodam."""
    return Path(os.environ.get("DEPLOY_DIR", "/deploy"))


def _update_log_dir() -> Path:
    log_dir = Path(os.environ.get("DATA_DIR", "/app/data")) / "update_logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir


def is_auto_update_enabled() -> bool:
    """Desligado por padrao -- da acesso ao socket do Docker do host (root-equivalente),
    entao so fica ativo se quem instalou decidir explicitamente (ver README)."""
    return os.environ.get("ENABLE_AUTO_UPDATE", "false").strip().lower() in ("1", "true", "yes")


def _parse_version(raw: str) -> tuple[int, ...]:
    """'v1.4.0' ou '1.4.0' -> (1, 4, 0). Sufixos nao numericos (ex: '1.4.0-beta') cortam
    a partir dali -- comparacao so cobre release estavel, que e o unico formato publicado."""
    cleaned = raw.strip().lstrip("vV").split("-")[0]
    parts = []
    for piece in cleaned.split("."):
        if not piece.isdigit():
            break
        parts.append(int(piece))
    return tuple(parts) or (0,)


def is_newer(candidate: str, current: str) -> bool:
    if current == "dev":
        # Build local sem tag -- nunca oferece "atualizacao" porque nao ha versao de referencia.
        return False
    return _parse_version(candidate) > _parse_version(current)


def fetch_release_history(limit: int = 10, force: bool = False) -> list[ReleaseInfo]:
    """Ultimas releases publicadas no GitHub, mais recente primeiro. Marca qual delas e a
    versao rodando agora (settings.app_version, gravada em /app/VERSION no build)."""
    return _cached(f"history:{limit}", lambda: _fetch_release_history(limit), force)


def _fetch_release_history(limit: int) -> list[ReleaseInfo]:
    response = httpx.get(
        f"{GITHUB_API_BASE}/releases",
        params={"per_page": limit},
        headers={"Accept": "application/vnd.github+json"},
        timeout=_HTTP_TIMEOUT,
    )
    response.raise_for_status()
    releases = []
    for item in response.json():
        version = item["tag_name"].lstrip("vV")
        releases.append(
            ReleaseInfo(
                version=version,
                name=item.get("name") or item["tag_name"],
                changelog=item.get("body") or "",
                published_at=item.get("published_at"),
                is_current=version == settings.app_version,
            )
        )
    return releases


def fetch_latest_release(force: bool = False) -> Optional[ReleaseInfo]:
    """`force=True` ignora o cache -- usado ao aplicar a atualizacao, que precisa da versao real."""
    return _cached("latest", _fetch_latest_release, force)


def _fetch_latest_release() -> Optional[ReleaseInfo]:
    response = httpx.get(
        f"{GITHUB_API_BASE}/releases/latest",
        headers={"Accept": "application/vnd.github+json"},
        timeout=_HTTP_TIMEOUT,
    )
    if response.status_code == 404:
        # Repo sem nenhuma release publicada ainda.
        return None
    response.raise_for_status()
    item = response.json()
    version = item["tag_name"].lstrip("vV")
    return ReleaseInfo(
        version=version,
        name=item.get("name") or item["tag_name"],
        changelog=item.get("body") or "",
        published_at=item.get("published_at"),
        is_current=version == settings.app_version,
    )


def apply_update(target_version: str) -> Path:
    """Dispara a atualizacao em background e retorna o arquivo de log. O processo do backend
    provavelmente vai morrer no meio (o proprio container e recriado) -- por isso roda
    desacoplado (`start_new_session`) em vez de esperar o resultado dentro da requisicao.

    Nao toca em volumes (`backend_data`/`backend_uploads`), so troca a imagem e recria os
    containers -- banco, uploads e os secrets gerados automaticamente continuam intactos.
    """
    deploy_dir = _deploy_dir()
    compose_file = deploy_dir / "docker-compose.yml"
    if not compose_file.exists():
        raise FileNotFoundError(
            f"docker-compose.yml nao encontrado em {deploy_dir} -- verifique se o volume "
            "`.:/deploy:ro` esta montado no servico backend."
        )

    lock_path = _acquire_apply_lock()

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    log_path = _update_log_dir() / f"{timestamp}_v{target_version}.log"

    env = os.environ.copy()
    env["APP_VERSION"] = target_version

    try:
        with open(log_path, "wb") as log_file:
            log_file.write(f"Atualizando para v{target_version}\n".encode("utf-8"))
            log_file.flush()
            subprocess.Popen(
                [
                    "sh",
                    "-c",
                    f"docker compose --project-directory {deploy_dir} -f {compose_file} pull "
                    f"&& docker compose --project-directory {deploy_dir} -f {compose_file} up -d",
                ],
                stdout=log_file,
                stderr=subprocess.STDOUT,
                env=env,
                start_new_session=True,
            )
    except Exception:
        # Nao conseguiu disparar: solta a trava, senao o admin ficaria bloqueado ate ela expirar
        lock_path.unlink(missing_ok=True)
        raise

    # Em sucesso a trava fica de proposito: o processo segue em background e o container vai ser
    # recriado. Ela expira sozinha (APPLY_LOCK_STALE_SECONDS).
    return log_path


def _acquire_apply_lock() -> Path:
    """Cria a trava de forma atomica (O_EXCL). Se ja existe e nao esta velha, ha outra
    atualizacao em andamento."""
    lock_path = _update_log_dir() / "apply.lock"
    try:
        if time.time() - lock_path.stat().st_mtime > APPLY_LOCK_STALE_SECONDS:
            lock_path.unlink(missing_ok=True)
    except FileNotFoundError:
        pass
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise UpdateAlreadyRunning(
            "Ja existe uma atualizacao em andamento -- aguarde alguns minutos antes de tentar de novo."
        )
    os.close(fd)
    return lock_path


def list_update_logs() -> list[dict]:
    log_dir = _update_log_dir()
    logs = []
    for path in sorted(log_dir.glob("*.log"), reverse=True)[:MAX_UPDATE_LOGS]:
        content = path.read_text(encoding="utf-8", errors="replace")
        if len(content) > MAX_LOG_CHARS:
            content = "[... inicio do log omitido ...]\n" + content[-MAX_LOG_CHARS:]
        logs.append({"filename": path.name, "content": content})
    return logs

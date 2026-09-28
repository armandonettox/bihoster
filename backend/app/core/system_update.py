import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from pydantic import BaseModel

from app.core.config import settings

GITHUB_REPO = "armandonettox/bihoster"
GITHUB_API_BASE = f"https://api.github.com/repos/{GITHUB_REPO}"
# Sem autenticacao -- endpoint publico de um repo publico, rate limit de 60 req/h por IP
# e mais que suficiente pro uso (a aba so consulta ao abrir e ao clicar em "Atualizar").
_HTTP_TIMEOUT = 10.0


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


def fetch_release_history(limit: int = 10) -> list[ReleaseInfo]:
    """Ultimas releases publicadas no GitHub, mais recente primeiro. Marca qual delas e a
    versao rodando agora (settings.app_version, gravada em /app/VERSION no build)."""
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


def fetch_latest_release() -> Optional[ReleaseInfo]:
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

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    log_path = _update_log_dir() / f"{timestamp}_v{target_version}.log"

    env = os.environ.copy()
    env["APP_VERSION"] = target_version

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

    return log_path


def list_update_logs() -> list[dict]:
    log_dir = _update_log_dir()
    logs = []
    for path in sorted(log_dir.glob("*.log"), reverse=True):
        logs.append({"filename": path.name, "content": path.read_text(encoding="utf-8", errors="replace")})
    return logs

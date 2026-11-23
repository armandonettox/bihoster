import json
import os
import re
import shlex
import shutil
import sqlite3
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional, TypeVar

import httpx
from pydantic import BaseModel
from sqlalchemy.engine import make_url

from app.core import changelog
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
# Quantas copias do banco feitas antes de atualizar ficam guardadas (as mais velhas sao apagadas)
MAX_UPDATE_BACKUPS = 5

_T = TypeVar("_T")


class UpdateAlreadyRunning(Exception):
    """Ja existe uma atualizacao em andamento neste host."""


class UpdateCouldNotStart(Exception):
    """O Docker recusou iniciar o container que faz a atualizacao."""


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


def _backup_dir() -> Path:
    backup_dir = Path(os.environ.get("DATA_DIR", "/app/data")) / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    return backup_dir


def _database_file() -> Optional[Path]:
    """O arquivo do banco SQLite em uso, ou None quando o banco nao e um arquivo (em memoria)."""
    url = make_url(settings.database_url)
    if url.get_backend_name() != "sqlite":
        raise UpdateCouldNotStart("o banco nao e SQLite, e so SQLite sabe ser copiado por aqui")
    if not url.database or url.database == ":memory:":
        return None
    return Path(url.database)


def backup_database(from_version: str, target_version: str, database_file: Optional[Path] = None) -> Optional[Path]:
    """Copia o banco (e o .env, se a pasta do projeto estiver montada) para a pasta de backups do volume de dados, antes
    de atualizar. Usa a API de copia do SQLite, que e consistente mesmo com o banco em uso. Devolve o caminho da copia do
    banco, ou None se o banco nao e um arquivo (nada a copiar).

    Se nao conseguir copiar, levanta UpdateCouldNotStart: atualizar sem a copia nao pode acontecer. Guarda so as
    MAX_UPDATE_BACKUPS copias mais novas."""
    source = database_file if database_file is not None else _database_file()
    if source is None:
        return None
    if not source.is_file():
        raise UpdateCouldNotStart(f"o arquivo do banco nao foi encontrado em {source}")

    backup_dir = _backup_dir()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = f"v{from_version}-para-v{target_version}-{stamp}"
    destination = backup_dir / f"db-antes-{suffix}.db"
    try:
        origin = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)
        copy = sqlite3.connect(destination)
        try:
            origin.backup(copy)
            integrity = copy.execute("pragma integrity_check").fetchone()[0]
        finally:
            copy.close()
            origin.close()
        if integrity != "ok":
            raise UpdateCouldNotStart(f"a copia do banco falhou na verificacao de integridade ({integrity})")
        destination.chmod(0o600)
        env_file = _deploy_dir() / ".env"
        if env_file.is_file():
            env_copy = backup_dir / f"env-antes-{suffix}"
            shutil.copyfile(env_file, env_copy)
            env_copy.chmod(0o600)
    except UpdateCouldNotStart:
        destination.unlink(missing_ok=True)
        raise
    except (OSError, sqlite3.Error) as exc:
        destination.unlink(missing_ok=True)
        raise UpdateCouldNotStart(f"nao foi possivel copiar o banco: {exc}") from exc

    _prune_backups(backup_dir)
    return destination


def _prune_backups(backup_dir: Path) -> None:
    """Apaga as copias mais velhas alem do limite (so os arquivos que este modulo cria), junto com o .env de cada uma."""
    copies = sorted(backup_dir.glob("db-antes-*.db"), key=lambda path: path.stat().st_mtime, reverse=True)
    for old in copies[MAX_UPDATE_BACKUPS:]:
        old.unlink(missing_ok=True)
        (backup_dir / old.name.replace("db-antes-", "env-antes-").removesuffix(".db")).unlink(missing_ok=True)


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


# Tags de versao (v1.2.3). Pre-lancamentos e outras tags nao contam.
_TAG_PATTERN = re.compile(r"v?(\d+\.\d+\.\d+)")
# O GitHub devolve no maximo 100 tags por pagina; cinco paginas cobrem 500 versoes
_MAX_TAG_PAGES = 5
_GITHUB_HEADERS = {"Accept": "application/vnd.github+json"}


def local_history() -> list[ReleaseInfo]:
    """Todas as versoes do historico que vem junto com o sistema (app/changelog/CHANGELOG.md), da mais recente para a
    mais antiga. Nao consulta o GitHub: o historico sempre bate com a versao instalada."""
    return [
        ReleaseInfo(
            version=entry.version,
            name=entry.title,
            changelog=entry.body,
            published_at=entry.date,
            is_current=entry.version == settings.app_version,
        )
        for entry in changelog.load_entries()
    ]


def fetch_latest_release(force: bool = False) -> Optional[ReleaseInfo]:
    """A versao mais nova publicada no GitHub. `force=True` ignora o cache -- usado ao aplicar a atualizacao, que precisa
    da versao real."""
    return _cached("latest", _fetch_latest_release, force)


def _latest_tag_version() -> Optional[str]:
    """A maior versao entre as tags do repositorio. Olha as tags, e nao as Releases, porque nem toda tag ganha uma
    Release (o projeto passou muitas versoes sem publicar nenhuma, e a ultima Release virou a mais velha da lista)."""
    best: Optional[str] = None
    for page in range(1, _MAX_TAG_PAGES + 1):
        response = httpx.get(
            f"{GITHUB_API_BASE}/tags",
            params={"per_page": 100, "page": page},
            headers=_GITHUB_HEADERS,
            timeout=_HTTP_TIMEOUT,
        )
        response.raise_for_status()
        items = response.json()
        for item in items:
            match = _TAG_PATTERN.fullmatch(item.get("name", ""))
            if match and (best is None or _parse_version(match.group(1)) > _parse_version(best)):
                best = match.group(1)
        if len(items) < 100:
            break
    return best


def _fetch_latest_release() -> Optional[ReleaseInfo]:
    version = _latest_tag_version()
    if version is None:
        # Repo sem nenhuma tag de versao ainda.
        return None

    response = httpx.get(
        f"{GITHUB_API_BASE}/releases/tags/v{version}",
        headers=_GITHUB_HEADERS,
        timeout=_HTTP_TIMEOUT,
    )
    if response.status_code == 404:
        # Tag sem Release: usa as notas do historico, se esta versao ja estiver nele, e senao so o numero.
        entry = changelog.entry_for(version)
        return ReleaseInfo(
            version=version,
            name=entry.title if entry else f"v{version}",
            changelog=entry.body if entry else "",
            published_at=entry.date if entry else None,
            is_current=version == settings.app_version,
        )
    response.raise_for_status()
    item = response.json()
    return ReleaseInfo(
        version=version,
        name=item.get("name") or item["tag_name"],
        changelog=item.get("body") or "",
        published_at=item.get("published_at"),
        is_current=version == settings.app_version,
    )


def _inspect_self() -> Optional[dict]:
    """O que o Docker sabe deste proprio container (imagem, rotulos do compose), ou None se nao der para saber: fora do
    Docker, sem o socket montado ou sem o docker no PATH. O nome do host de um container e o id dele."""
    ident = os.environ.get("HOSTNAME", "").strip()
    if not ident:
        return None
    try:
        result = subprocess.run(["docker", "inspect", ident], capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    try:
        data = json.loads(result.stdout)
    except ValueError:
        return None
    return data[0] if isinstance(data, list) and data and isinstance(data[0], dict) else None


def build_helper_command(
    info: dict, target_version: str, log_path: Path, deploy_dir: Path, helper_name: str
) -> Optional[list[str]]:
    """O `docker run` do container auxiliar que atualiza o sistema, ou None se faltar algo para montar o comando.

    Por que um container auxiliar: o `docker compose up -d` recria o backend, e um comando que roda dentro do backend morre
    junto com ele no meio da troca. O auxiliar usa a mesma imagem (que ja tem o docker e o compose), os mesmos volumes
    (`--volumes-from`: o socket do Docker, a pasta do projeto e os dados, onde fica o log) e termina sozinho.

    O nome do projeto, a pasta real do projeto no servidor e os arquivos do compose (inclusive o override) saem dos
    rotulos que o proprio compose gravou neste container. Sem isso o `docker compose` de dentro do container calcularia
    outro nome de projeto (a pasta aqui dentro se chama deploy), ignoraria o override e subiria uma pilha paralela, com
    volumes vazios, em vez de atualizar a que esta rodando."""
    config = info.get("Config") or {}
    labels = config.get("Labels") or {}
    project = labels.get("com.docker.compose.project")
    workdir = labels.get("com.docker.compose.project.working_dir")
    host_files = [f for f in (labels.get("com.docker.compose.project.config_files") or "").split(",") if f]
    image = config.get("Image")
    container_id = info.get("Id")
    if not (project and workdir and host_files and image and container_id):
        return None

    # Os arquivos do compose, como aparecem montados aqui (so o nome do arquivo conta: eles ficam na pasta do projeto)
    files = []
    for host_file in host_files:
        name = host_file.replace("\\", "/").rsplit("/", 1)[-1]
        if not (deploy_dir / name).is_file():
            return None
        files.append(f"{deploy_dir.as_posix()}/{name}")

    compose = ["docker", "compose", "-p", project, "--project-directory", workdir]
    if (deploy_dir / ".env").is_file():
        compose += ["--env-file", f"{deploy_dir.as_posix()}/.env"]
    for file in files:
        compose += ["-f", file]

    log = shlex.quote(str(log_path))
    pull = " ".join(shlex.quote(part) for part in compose + ["pull"])
    up = " ".join(shlex.quote(part) for part in compose + ["up", "-d"])
    script = f"{pull} >> {log} 2>&1 && {up} >> {log} 2>&1"

    return [
        "docker", "run", "-d", "--rm",
        "--name", helper_name,
        "--user", "root",
        "--entrypoint", "sh",
        "--volumes-from", container_id,
        "-e", f"APP_VERSION={target_version}",
        image,
        "-c", script,
    ]


def apply_update(target_version: str) -> Path:
    """Dispara a atualizacao em background e retorna o arquivo de log. O backend vai ser recriado no meio do caminho, por
    isso quem roda o `docker compose` e um container auxiliar (ver build_helper_command), e nao este processo.

    Nao toca em volumes (`backend_data`/`backend_uploads`), so troca a imagem e recria os
    containers -- banco, uploads e os secrets gerados automaticamente continuam intactos.
    """
    deploy_dir = _deploy_dir()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    log_path = _update_log_dir() / f"{timestamp}_v{target_version}.log"

    info = _inspect_self()
    helper = (
        build_helper_command(info, target_version, log_path, deploy_dir, f"bihoster-updater-{timestamp}")
        if info
        else None
    )

    compose_file = deploy_dir / "docker-compose.yml"
    if helper is None and not compose_file.exists():
        raise FileNotFoundError(
            f"docker-compose.yml nao encontrado em {deploy_dir} -- verifique se o volume "
            "`.:/deploy:ro` esta montado no servico backend."
        )

    lock_path = _acquire_apply_lock()

    try:
        with open(log_path, "wb") as log_file:
            log_file.write(f"Atualizando para v{target_version}\n".encode("utf-8"))
            log_file.flush()
            if helper is None:
                # Sem os rotulos do compose (ex: instalacao fora do compose): o jeito antigo, direto daqui
                env = os.environ.copy()
                env["APP_VERSION"] = target_version
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
            else:
                result = subprocess.run(helper, capture_output=True, text=True, timeout=60)
                if result.returncode != 0:
                    raise UpdateCouldNotStart((result.stderr or result.stdout or "o Docker recusou").strip()[-400:])
                log_file.write(f"Container auxiliar iniciado: {result.stdout.strip()[:20]}\n".encode("utf-8"))
    except Exception as exc:
        # Nao conseguiu disparar: solta a trava, senao o admin ficaria bloqueado ate ela expirar
        lock_path.unlink(missing_ok=True)
        if isinstance(exc, subprocess.SubprocessError):
            raise UpdateCouldNotStart(str(exc)) from exc
        raise

    # Em sucesso a trava fica de proposito: a atualizacao segue em background e o backend vai ser recriado. Ela
    # expira sozinha (APPLY_LOCK_STALE_SECONDS).
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

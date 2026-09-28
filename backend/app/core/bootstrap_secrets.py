import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

_INSECURE_DEFAULT = "change-me-in-env"
_SECRET_ENV_VARS = ("JWT_SECRET", "ENCRYPTION_KEY")


def _data_dir() -> Path:
    """Mesmo diretorio usado pelo volume persistente do Docker (/app/data, ver Dockerfile/
    docker-compose.yml) -- localmente vira ./data ao lado de onde o backend roda."""
    return Path(os.environ.get("DATA_DIR", "data"))


def _generate_and_persist(env_var: str, data_dir: Path) -> str:
    file_path = data_dir / f".{env_var.lower()}"
    if file_path.exists():
        value = file_path.read_text(encoding="utf-8").strip()
        if value:
            return value
    value = secrets.token_hex(32)
    data_dir.mkdir(parents=True, exist_ok=True)
    file_path.write_text(value, encoding="utf-8")
    return value


def ensure_secrets() -> None:
    """Gera JWT_SECRET/ENCRYPTION_KEY automaticamente no primeiro boot se nao foram definidos
    (ou estao no valor de exemplo do .env.example), e persiste no volume de dados -- assim
    quem instala via `docker compose up -d` nao precisa gerar/colar nenhum secret a mao antes
    de comecar a usar, mas quem quiser definir os proprios (recomendado em producao "de verdade")
    continua podendo, via variavel de ambiente normal.

    Roda ANTES da instanciacao de `Settings()` (BaseSettings le de os.environ na hora de
    construir), entao precisa ficar no import de core/config.py antes da classe.
    """
    # Carrega o .env pra dentro de os.environ ANTES de checar -- sem isso, um JWT_SECRET/
    # ENCRYPTION_KEY que ja existe no .env seria ignorado aqui (pydantic-settings so aplica o
    # env_file na hora de construir Settings(), que acontece depois desta funcao rodar) e a
    # gente geraria um segredo novo redundante toda vez, nao usaria o que ja esta configurado.
    load_dotenv(override=False)

    data_dir = _data_dir()
    for env_var in _SECRET_ENV_VARS:
        current = os.environ.get(env_var, "")
        if current and current != _INSECURE_DEFAULT:
            continue
        os.environ[env_var] = _generate_and_persist(env_var, data_dir)

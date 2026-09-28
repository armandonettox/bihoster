import os
from pathlib import Path

from pydantic_settings import BaseSettings

from app.core.bootstrap_secrets import ensure_secrets

ensure_secrets()


def _read_app_version() -> str:
    """Le de /app/VERSION (gravado no build da imagem, ver Dockerfile) -- nao de env var, pra
    nao poder ser falsificado por uma variavel esquecida no host. Fora do container (dev local
    sem Docker) o arquivo nao existe, entao cai pra "dev"."""
    version_file = Path(os.environ.get("VERSION_FILE", "/app/VERSION"))
    try:
        value = version_file.read_text(encoding="utf-8").strip()
        return value or "dev"
    except OSError:
        return "dev"


class Settings(BaseSettings):
    app_version: str = _read_app_version()
    # Configuracoes gerais da aplicacao, lidas de variaveis de ambiente ou .env
    database_url: str = "sqlite:///./bihoster.db"
    jwt_secret: str = "change-me-in-env"
    jwt_algorithm: str = "HS256"
    # Usada para cifrar secrets guardados no banco (client_secret do Power BI, do Google OAuth)
    # em repouso -- separada do jwt_secret pra nao acoplar rotacao de uma na outra.
    encryption_key: str = "change-me-in-env"
    access_token_expire_minutes: int = 60
    max_failed_login_attempts: int = 5
    account_lock_minutes: int = 15
    cors_origins: str = "http://localhost:5173"
    # Desligado por padrao -- so ligar quando o backend roda atras de um reverse proxy confiavel
    # (nginx/Caddy/Traefik do proprio host) que sempre define X-Forwarded-Proto. Com um proxy
    # TLS-terminating na frente, o uvicorn so ve conexoes HTTP puras (o proxy fala com o backend
    # em texto claro) -- sem isso, force_https (Configuracoes > Geral) entra em loop de redirect
    # 301 pra sempre, porque a app nunca enxerga "https" de verdade. Nunca ativar se o backend
    # estiver exposto direto na internet sem proxy na frente -- qualquer cliente poderia forjar
    # o header e enganar essa checagem.
    trust_proxy_headers: bool = False

    class Config:
        env_file = ".env"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()

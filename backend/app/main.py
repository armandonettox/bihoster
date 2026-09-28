from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core import powerbi as core_powerbi
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.core.rate_limit import limiter
from app.models import audit_log, favorite, invite, password_reset, powerbi_connection, report, user, workspace  # noqa: F401
from app.models import settings as settings_model  # noqa: F401
from app.routers import (  # noqa: F401
    audit,
    auth,
    favorites,
    groups,
    home,
    powerbi,
    powerbi_catalog,
    powerbi_connections,
    reports,
    search,
    system,
    users,
)
from app.routers import settings as settings_router
from app.routers import workspaces

Base.metadata.create_all(bind=engine)

# Mesma string usada como default em Settings.jwt_secret/encryption_key (core/config.py) --
# centralizada aqui pra essas duas checagens nao dessincronizarem se o default mudar um dia.
_INSECURE_DEFAULT = "change-me-in-env"

if not settings.jwt_secret or settings.jwt_secret == _INSECURE_DEFAULT:
    raise RuntimeError(
        "JWT_SECRET nao foi definido ou esta no valor padrao ('change-me-in-env') -- defina uma "
        "chave real e aleatoria na variavel de ambiente JWT_SECRET (ou no .env) antes de subir a "
        "aplicacao. Um valor vazio ou publico permite forjar tokens de qualquer usuario, inclusive "
        "administrador."
    )
if len(settings.jwt_secret) < 32:
    raise RuntimeError(
        "JWT_SECRET tem menos de 32 caracteres -- muito curto pra ser seguro com HS256. Defina uma "
        "chave aleatoria mais longa (ex: `openssl rand -hex 32`)."
    )
if not settings.encryption_key or settings.encryption_key == _INSECURE_DEFAULT:
    raise RuntimeError(
        "ENCRYPTION_KEY nao foi definida ou esta no valor padrao ('change-me-in-env') -- defina uma "
        "chave real e aleatoria na variavel de ambiente ENCRYPTION_KEY (ou no .env) antes de subir a "
        "aplicacao. Ela cifra os secrets do Power BI/Google guardados no banco."
    )

app = FastAPI(title="BIHoster Python")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(core_powerbi.PowerBIError)
async def powerbi_error_handler(request: Request, exc: core_powerbi.PowerBIError):
    """Centraliza o 502 de falha ao chamar o Power BI -- evita repetir o mesmo
    try/except em cada endpoint de routers/powerbi.py e powerbi_catalog.py."""
    return JSONResponse(status_code=502, content={"detail": str(exc)})

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOCAL_HOSTS = {"localhost", "127.0.0.1"}


def _is_force_https_enabled() -> bool:
    """Query sincrona isolada para rodar em threadpool -- nao pode bloquear o event loop async."""
    from app.models.settings import AppSettings

    db = SessionLocal()
    try:
        settings_row = db.query(AppSettings).filter(AppSettings.id == 1).first()
        return bool(settings_row and settings_row.force_https)
    finally:
        db.close()


def _request_scheme(request: Request) -> str:
    """O scheme "real" da requisicao. Atras de um reverse proxy que termina TLS (padrao em
    self-host com nginx/Caddy na frente), uvicorn so ve a conexao HTTP pura entre o proxy e o
    backend -- request.url.scheme e sempre "http", mesmo com o cliente acessando via https.
    So confia no header X-Forwarded-Proto quando TRUST_PROXY_HEADERS=true (ver core/config.py)."""
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-proto")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.url.scheme


@app.middleware("http")
async def force_https_redirect(request: Request, call_next):
    """So redireciona http->https quando habilitado em Configuracoes e o host nao e local
    (evita quebrar o ambiente de desenvolvimento)."""
    host = request.url.hostname or ""
    if _request_scheme(request) == "http" and host not in LOCAL_HOSTS:
        if await run_in_threadpool(_is_force_https_enabled):
            https_url = request.url.replace(scheme="https")
            return RedirectResponse(url=str(https_url), status_code=301)

    return await call_next(request)


# Absoluto (relativo a este arquivo, nao ao cwd) -- rodar `uvicorn app.main:app` de um
# diretorio diferente de backend/ nao deve quebrar silenciosamente o serving de uploads.
_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")

app.include_router(auth.router)
app.include_router(workspaces.router)
app.include_router(groups.router)
app.include_router(reports.router)
app.include_router(powerbi.router)
app.include_router(powerbi_catalog.router)
app.include_router(powerbi_connections.router)
app.include_router(audit.router)
app.include_router(audit.workspace_router)
app.include_router(settings_router.router)
app.include_router(favorites.router)
app.include_router(users.router)
app.include_router(home.router)
app.include_router(search.router)
app.include_router(system.router)


@app.get("/health")
def health():
    return {"status": "ok"}

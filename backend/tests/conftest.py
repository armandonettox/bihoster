import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
# Precisa importar todos os modelos antes do create_all -- mesmo padrao usado em app/main.py --
# senao tabelas referenciadas so por FK (sem import direto aqui) nao sao criadas.
from app.models import audit_log, favorite, invite, password_reset, powerbi_connection, report, user, workspace  # noqa: F401
from app.models import settings as settings_model  # noqa: F401


@pytest.fixture()
def db_session():
    """Sessao de banco isolada por teste -- SQLite em memoria, schema recriado do zero."""
    # StaticPool -- sem isso, cada conexao nova do pool pra um SQLite em memoria enxerga um
    # banco vazio diferente (o TestClient roda os endpoints sync numa threadpool, entao
    # precisa da MESMA conexao sendo reaproveitada, nao uma nova por checkout).
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def make_user(db_session):
    from app.models.user import User

    def _make(email: str, name: str = "Teste") -> User:
        u = User(name=name, email=email, hashed_password="x")
        db_session.add(u)
        db_session.commit()
        db_session.refresh(u)
        return u

    return _make


@pytest.fixture()
def make_workspace(db_session):
    from app.models.workspace import Workspace

    def _make(name: str, slug: str | None = None) -> Workspace:
        w = Workspace(name=name, slug=slug or name.lower().replace(" ", "-"))
        db_session.add(w)
        db_session.commit()
        db_session.refresh(w)
        return w

    return _make


@pytest.fixture()
def client(db_session):
    """TestClient da API real, com o banco trocado pela sessao isolada de db_session --
    exercita rotas HTTP de verdade (auth, permissao via dependency, etc), nao so funcoes
    isoladas. Reseta o rate limiter entre testes pra um teste nao esgotar o limite de
    outro (ex: 5/min em /auth/register)."""
    from fastapi.testclient import TestClient

    from app.core.database import get_db
    from app.core.rate_limit import limiter
    from app.main import app

    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    limiter.reset()
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        limiter.reset()

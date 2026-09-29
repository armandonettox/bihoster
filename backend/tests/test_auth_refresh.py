"""Sessao deslizante: POST /auth/refresh troca um token ainda valido por um novo (mais 60 min),
sem novo login. Sem isso, a TV e qualquer aba aberta caem depois de 60 min. Tem que respeitar:
usuario apagado, conta bloqueada, teto absoluto da sessao e troca de senha."""

from datetime import datetime, timedelta, timezone

from jose import jwt

from app.core import security
from app.core.config import settings
from app.models.user import User


def _register(client, email: str = "admin@example.com", password: str = "SenhaForte123") -> None:
    client.post("/auth/register", json={"name": "Admin", "email": email, "password": password})


def _login_token(client, email: str = "admin@example.com", password: str = "SenhaForte123") -> str:
    return client.post("/auth/login", json={"email": email, "password": password}).json()["access_token"]


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _claims(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def _refresh(client, token: str):
    return client.post("/auth/refresh", headers=_bearer(token))


def _make_token(db_session, **kwargs) -> str:
    """Token montado como o servidor monta, com o hash da senha do usuario real (senao a
    impressao da senha nao bate e a renovacao recusa, corretamente)."""
    user = db_session.query(User).first()
    return security.create_access_token(subject=str(user.id), password_hash=user.hashed_password, **kwargs)


def test_refresh_devolve_token_novo_que_funciona(client):
    _register(client)
    old = _login_token(client)

    resp = _refresh(client, old)

    assert resp.status_code == 200
    new = resp.json()["access_token"]
    assert new
    assert client.get("/auth/me", headers=_bearer(new)).status_code == 200


def test_refresh_estende_a_validade(client, db_session):
    _register(client)
    # Token velho, quase vencendo (expira em 2 min)
    almost = _make_token(db_session)
    almost_claims = _claims(almost)
    almost_claims["exp"] = int((datetime.now(timezone.utc) + timedelta(minutes=2)).timestamp())
    almost = jwt.encode(almost_claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    new = _refresh(client, almost).json()["access_token"]

    restante = _claims(new)["exp"] - datetime.now(timezone.utc).timestamp()
    assert restante > (settings.access_token_expire_minutes - 1) * 60


def test_refresh_preserva_o_momento_do_login_original(client):
    """A renovacao nao pode "zerar" o teto da sessao: auth_at continua sendo o do login."""
    _register(client)
    old = _login_token(client)
    auth_at = _claims(old)["auth_at"]

    new = _refresh(client, old).json()["access_token"]
    newer = _refresh(client, new).json()["access_token"]

    assert _claims(new)["auth_at"] == auth_at
    assert _claims(newer)["auth_at"] == auth_at


def test_refresh_exige_token(client):
    assert client.post("/auth/refresh").status_code == 401
    assert _refresh(client, "lixo").status_code == 401


def test_refresh_recusa_sessao_alem_do_teto_absoluto(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "session_max_hours", 24)
    _register(client)
    velho = _make_token(db_session, auth_at=datetime.now(timezone.utc) - timedelta(hours=25))

    resp = _refresh(client, velho)

    assert resp.status_code == 401
    # Precisa ser o teto (expirada), nao a impressao da senha (invalida)
    assert "expirada" in resp.json()["detail"].lower()


def test_refresh_dentro_do_teto_funciona(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "session_max_hours", 24)
    _register(client)
    token = _make_token(db_session, auth_at=datetime.now(timezone.utc) - timedelta(hours=23))

    assert _refresh(client, token).status_code == 200


def test_teto_zero_desliga_o_limite(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "session_max_hours", 0)
    _register(client)
    token = _make_token(db_session, auth_at=datetime.now(timezone.utc) - timedelta(days=400))

    assert _refresh(client, token).status_code == 200


def test_refresh_de_usuario_apagado_da_401(client, db_session):
    _register(client)
    token = _login_token(client)
    db_session.query(User).delete()
    db_session.commit()

    assert _refresh(client, token).status_code == 401


def test_refresh_de_conta_bloqueada_da_401(client, db_session):
    _register(client)
    token = _login_token(client)
    user = db_session.query(User).first()
    user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=15)
    db_session.commit()

    assert _refresh(client, token).status_code == 401


def test_trocar_a_senha_corta_a_renovacao(client, db_session):
    """Depois de trocar a senha, um token roubado nao pode continuar se renovando."""
    _register(client)
    token = _login_token(client)
    assert _refresh(client, token).status_code == 200

    user = db_session.query(User).first()
    user.hashed_password = security.hash_password("OutraSenha456")
    db_session.commit()

    resp = _refresh(client, token)
    assert resp.status_code == 401
    assert "invalida" in resp.json()["detail"].lower()


def test_token_antigo_sem_claims_novas_ainda_renova(client):
    """Tokens emitidos antes desta versao nao tem auth_at nem pv: continuam validos e renovaveis."""
    _register(client)
    uid = _claims(_login_token(client))["sub"]
    legado = jwt.encode(
        {"sub": uid, "exp": datetime.now(timezone.utc) + timedelta(minutes=30)},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )

    resp = _refresh(client, legado)

    assert resp.status_code == 200
    assert "auth_at" in _claims(resp.json()["access_token"])


def test_login_ja_emite_token_com_as_claims_da_sessao(client):
    _register(client)

    claims = _claims(_login_token(client))

    assert "auth_at" in claims and "pv" in claims

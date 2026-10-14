"""Testes da conta propria: trocar nome e senha (PATCH /auth/me, POST /auth/change-password)."""

from datetime import datetime, timedelta, timezone

from jose import jwt

from app.core.config import settings
from app.core.security import create_access_token, hash_password
from app.models.audit_log import AuditLog
from app.models.user import User

PASSWORD = "SenhaForte123"
NEW_PASSWORD = "OutraSenha456"


def _register(client, email: str = "pessoa@example.com") -> str:
    client.post("/auth/register", json={"name": "Pessoa", "email": email, "password": PASSWORD})
    return _login(client, email, PASSWORD)


def _login(client, email: str, password: str) -> str:
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _change(client, token: str, current: str, new: str):
    return client.post(
        "/auth/change-password", json={"current_password": current, "new_password": new}, headers=_headers(token)
    )


# --- nome ---


def test_me_informa_que_a_senha_pode_ser_trocada(client):
    token = _register(client)
    assert client.get("/auth/me", headers=_headers(token)).json()["can_change_password"] is True


def test_trocar_o_proprio_nome(client):
    token = _register(client)

    resp = client.patch("/auth/me", json={"name": "  Novo Nome  "}, headers=_headers(token))

    assert resp.status_code == 200
    assert resp.json()["name"] == "Novo Nome"
    assert client.get("/auth/me", headers=_headers(token)).json()["name"] == "Novo Nome"


def test_nome_em_branco_ou_longo_demais_e_recusado(client):
    token = _register(client)
    for bad in ["", "   ", "x" * 201]:
        resp = client.patch("/auth/me", json={"name": bad}, headers=_headers(token))
        assert resp.status_code == 422, bad
    assert client.get("/auth/me", headers=_headers(token)).json()["name"] == "Pessoa"


def test_trocar_nome_nao_muda_o_email(client):
    token = _register(client)
    resp = client.patch(
        "/auth/me", json={"name": "Outro", "email": "invasor@example.com"}, headers=_headers(token)
    )
    assert resp.status_code == 200
    assert resp.json()["email"] == "pessoa@example.com"


def test_trocar_nome_exige_login(client):
    assert client.patch("/auth/me", json={"name": "X"}).status_code == 401


def test_trocar_nome_so_afeta_o_proprio_usuario(client):
    token_a = _register(client, "a@example.com")
    token_b = _register(client, "b@example.com")

    client.patch("/auth/me", json={"name": "Nome do A"}, headers=_headers(token_a))

    assert client.get("/auth/me", headers=_headers(token_b)).json()["name"] == "Pessoa"


# --- senha ---


def test_trocar_a_senha_devolve_token_novo_e_a_senha_nova_passa_a_valer(client):
    token = _register(client)

    resp = _change(client, token, PASSWORD, NEW_PASSWORD)

    assert resp.status_code == 200
    new_token = resp.json()["access_token"]
    assert client.get("/auth/me", headers=_headers(new_token)).status_code == 200
    assert client.post("/auth/login", json={"email": "pessoa@example.com", "password": NEW_PASSWORD}).status_code == 200
    assert client.post("/auth/login", json={"email": "pessoa@example.com", "password": PASSWORD}).status_code == 401


def test_token_de_antes_da_troca_cai_na_hora_em_qualquer_rota(client):
    """Sem isso, quem trocou a senha por achar que a conta foi invadida ainda teria o invasor
    logado por ate 60 minutos."""
    token = _register(client)
    other_session = _login(client, "pessoa@example.com", PASSWORD)

    _change(client, token, PASSWORD, NEW_PASSWORD)

    for old in (token, other_session):
        assert client.get("/auth/me", headers=_headers(old)).status_code == 401
        assert client.get("/workspaces/", headers=_headers(old)).status_code == 401
        assert client.post("/auth/refresh", headers=_headers(old)).status_code == 401


def test_senha_atual_errada_da_400_e_nao_derruba_a_sessao(client):
    """O cliente trata 401 como sessao vencida e desloga: errar a senha nao pode ser 401."""
    token = _register(client)

    resp = _change(client, token, "senha-errada-1", NEW_PASSWORD)

    assert resp.status_code == 400
    assert "atual" in resp.json()["detail"].lower()
    assert client.get("/auth/me", headers=_headers(token)).status_code == 200
    # E a senha continua a antiga
    assert client.post("/auth/login", json={"email": "pessoa@example.com", "password": PASSWORD}).status_code == 200


def test_nova_senha_igual_a_atual_e_recusada(client):
    token = _register(client)
    resp = _change(client, token, PASSWORD, PASSWORD)
    assert resp.status_code == 400
    assert "diferente" in resp.json()["detail"].lower()


def test_nova_senha_curta_ou_longa_demais_da_422(client):
    token = _register(client)
    assert _change(client, token, PASSWORD, "curta").status_code == 422
    assert _change(client, token, PASSWORD, "a" * 73).status_code == 422
    # Nada mudou
    assert client.post("/auth/login", json={"email": "pessoa@example.com", "password": PASSWORD}).status_code == 200


def test_trocar_senha_exige_login(client):
    resp = client.post("/auth/change-password", json={"current_password": PASSWORD, "new_password": NEW_PASSWORD})
    assert resp.status_code == 401


def test_errar_a_senha_atual_varias_vezes_bloqueia_a_conta(client):
    token = _register(client)

    for _ in range(settings.max_failed_login_attempts):
        assert _change(client, token, "senha-errada-1", NEW_PASSWORD).status_code == 400

    # Bloqueada: a sessao aberta tambem deixa de funcionar, e o login responde 423
    assert client.get("/auth/me", headers=_headers(token)).status_code == 401
    assert client.post("/auth/login", json={"email": "pessoa@example.com", "password": PASSWORD}).status_code == 423


def test_trocar_a_senha_com_sucesso_zera_as_tentativas_erradas(client, db_session):
    token = _register(client)
    _change(client, token, "senha-errada-1", NEW_PASSWORD)
    _change(client, token, "senha-errada-2", NEW_PASSWORD)

    resp = _change(client, token, PASSWORD, NEW_PASSWORD)

    assert resp.status_code == 200
    user = db_session.query(User).filter(User.email == "pessoa@example.com").first()
    assert user.failed_login_attempts == 0


def test_conta_google_nao_troca_senha(client, db_session):
    user = User(name="Google", email="g@example.com", hashed_password=hash_password("x" * 12), registered_via="google")
    db_session.add(user)
    db_session.commit()
    token = create_access_token(subject=str(user.id), password_hash=user.hashed_password)

    me = client.get("/auth/me", headers=_headers(token)).json()
    resp = _change(client, token, "x" * 12, NEW_PASSWORD)

    assert me["can_change_password"] is False
    assert resp.status_code == 400
    assert "google" in resp.json()["detail"].lower()


# --- token e auditoria ---


def test_token_antigo_sem_a_claim_pv_continua_valendo(client):
    """Tokens emitidos antes da claim pv existir nao podem ser derrubados por ela."""
    _register(client)
    legacy = jwt.encode(
        {"sub": "1", "exp": datetime.now(timezone.utc) + timedelta(minutes=10)},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    assert client.get("/auth/me", headers=_headers(legacy)).status_code == 200


def test_senha_mudada_por_fora_tambem_derruba_o_token_antigo(client, db_session):
    """Mesmo caminho de um reset de senha feito por um admin: o hash muda sem passar pela rota."""
    token = _register(client)
    user = db_session.query(User).filter(User.email == "pessoa@example.com").first()
    user.hashed_password = hash_password("SenhaRedefinida789")
    db_session.commit()

    assert client.get("/auth/me", headers=_headers(token)).status_code == 401


def test_trocas_de_nome_e_senha_ficam_na_auditoria(client, db_session):
    token = _register(client)
    client.patch("/auth/me", json={"name": "Novo"}, headers=_headers(token))
    _change(client, token, PASSWORD, NEW_PASSWORD)

    actions = {row.action for row in db_session.query(AuditLog).all()}

    assert {"update_profile", "change_password"} <= actions

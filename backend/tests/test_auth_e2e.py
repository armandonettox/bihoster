"""Testes end-to-end do fluxo de autenticacao via TestClient (rota HTTP real, nao so a
funcao isolada) -- registro, login, bloqueio apos tentativas falhas, /auth/me."""


def test_registro_e_login_completo(client):
    resp = client.post(
        "/auth/register",
        json={"name": "Ana", "email": "ana@example.com", "password": "SenhaForte123"},
    )
    assert resp.status_code == 201
    assert resp.json()["email"] == "ana@example.com"

    resp = client.post("/auth/login", json={"email": "ana@example.com", "password": "SenhaForte123"})
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    assert token

    resp = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "ana@example.com"


def test_primeiro_usuario_vira_admin_da_plataforma(client):
    client.post(
        "/auth/register",
        json={"name": "Primeiro", "email": "primeiro@example.com", "password": "SenhaForte123"},
    )
    login = client.post("/auth/login", json={"email": "primeiro@example.com", "password": "SenhaForte123"})
    token = login.json()["access_token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["is_platform_admin"] is True


def test_segundo_usuario_nao_vira_admin(client):
    client.post(
        "/auth/register",
        json={"name": "Primeiro", "email": "primeiro2@example.com", "password": "SenhaForte123"},
    )
    client.post(
        "/auth/register",
        json={"name": "Segundo", "email": "segundo@example.com", "password": "SenhaForte123"},
    )
    login = client.post("/auth/login", json={"email": "segundo@example.com", "password": "SenhaForte123"})
    token = login.json()["access_token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["is_platform_admin"] is False


def test_email_duplicado_retorna_400_nao_500(client):
    payload = {"name": "Ana", "email": "duplicado@example.com", "password": "SenhaForte123"}
    resp1 = client.post("/auth/register", json=payload)
    assert resp1.status_code == 201

    resp2 = client.post("/auth/register", json=payload)
    assert resp2.status_code == 400
    assert "cadastrado" in resp2.json()["detail"].lower()


def test_login_com_senha_errada_nao_autentica(client):
    client.post(
        "/auth/register",
        json={"name": "Ana", "email": "senhaerrada@example.com", "password": "SenhaForte123"},
    )
    resp = client.post("/auth/login", json={"email": "senhaerrada@example.com", "password": "senha-invalida"})
    assert resp.status_code == 401


def test_login_com_email_inexistente_nao_autentica(client):
    resp = client.post("/auth/login", json={"email": "naoexiste@example.com", "password": "qualquer"})
    assert resp.status_code == 401


def test_bloqueio_de_conta_apos_tentativas_falhas(client):
    from app.core.config import settings

    email = "bloqueado@example.com"
    client.post("/auth/register", json={"name": "Bloqueado", "email": email, "password": "SenhaForte123"})

    for _ in range(settings.max_failed_login_attempts):
        client.post("/auth/login", json={"email": email, "password": "errada"})

    # Mesmo com a senha CERTA, a conta deve continuar bloqueada apos esgotar as tentativas.
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    assert resp.status_code == 423


def test_rota_protegida_sem_token_retorna_401(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_rota_admin_sem_ser_admin_retorna_403(client):
    """require_platform_admin bloqueia quem nao esta no grupo Administradores --
    exercitado aqui numa rota HTTP real (POST /workspaces/), nao so na funcao isolada."""
    client.post(
        "/auth/register",
        json={"name": "Primeiro", "email": "admin1@example.com", "password": "SenhaForte123"},
    )
    client.post(
        "/auth/register",
        json={"name": "Comum", "email": "comum@example.com", "password": "SenhaForte123"},
    )
    login = client.post("/auth/login", json={"email": "comum@example.com", "password": "SenhaForte123"})
    token = login.json()["access_token"]

    resp = client.post(
        "/workspaces/",
        json={"name": "Nova Colecao"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403

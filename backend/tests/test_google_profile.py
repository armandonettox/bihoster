"""Login com Google: foto guardada no servidor, conta marcada como Google e nomes padronizados."""

from unittest.mock import patch

from app.core import avatar
from app.core.names import format_person_name
from app.models.settings import AppSettings

PASSWORD = "SenhaForte123"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
PICTURE = "https://lh3.googleusercontent.com/a/foto123=s96-c"


def _enable_google(db_session):
    row = db_session.query(AppSettings).filter(AppSettings.id == 1).first() or AppSettings(id=1)
    row.google_oauth_enabled = True
    row.google_client_id = "fake-client-id"
    row.allow_registration = True
    db_session.add(row)
    db_session.commit()


def _google_login(
    client, email, name="Maria Souza", picture=PICTURE, downloaded="/static/uploads/avatar-1-abc.png", **extra_claims
):
    claims = {"email": email, "name": name, **extra_claims}
    if picture:
        claims["picture"] = picture
    with patch("google.oauth2.id_token.verify_oauth2_token", return_value=claims), patch(
        "app.routers.auth.download_avatar", return_value=downloaded
    ):
        return client.post("/auth/google", json={"id_token": "fake"})


def _me(client, token):
    return client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()


def test_conta_nova_do_google_guarda_a_foto_e_aparece_como_google(client, db_session):
    _enable_google(db_session)
    token = _google_login(client, "nova@example.com").json()["access_token"]

    me = _me(client, token)

    assert me["login_provider"] == "google"
    assert me["can_change_password"] is False
    assert me["picture_url"] == "/static/uploads/avatar-1-abc.png"


def test_conta_com_senha_que_entra_pelo_google_vira_conta_google(client, db_session):
    _enable_google(db_session)
    client.post("/auth/register", json={"name": "Pessoa", "email": "p@example.com", "password": PASSWORD})
    login = client.post("/auth/login", json={"email": "p@example.com", "password": PASSWORD}).json()
    assert _me(client, login["access_token"])["can_change_password"] is True

    token = _google_login(client, "p@example.com").json()["access_token"]
    me = _me(client, token)

    assert me["login_provider"] == "google"
    assert me["can_change_password"] is False
    resp = client.post(
        "/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "OutraSenha456"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400
    assert "google" in resp.json()["detail"].lower()


def test_falha_ao_baixar_a_foto_nao_barra_o_login_e_mantem_a_anterior(client, db_session):
    _enable_google(db_session)
    _google_login(client, "x@example.com")

    token = _google_login(client, "x@example.com", downloaded=None).json()["access_token"]

    assert _me(client, token)["picture_url"] == "/static/uploads/avatar-1-abc.png"


def test_resumo_da_conta_google_traz_datas_grupos_idioma_e_dominio(client, db_session):
    _enable_google(db_session)
    token = _google_login(client, "ana@empresa.com.br", locale="pt-BR", hd="empresa.com.br").json()["access_token"]

    me = _me(client, token)

    assert me["created_at"] is not None
    assert me["last_login_at"] is not None
    assert "Todos os usuarios" in me["groups"]
    assert me["is_platform_admin"] is True  # primeiro usuario da instancia
    assert "Administradores" in me["groups"]
    assert me["google_locale"] == "pt-BR"
    assert me["google_domain"] == "empresa.com.br"
    assert me["google_workspace"] is True


def test_conta_google_pessoal_usa_o_dominio_do_email_e_nao_e_workspace(client, db_session):
    _enable_google(db_session)
    token = _google_login(client, "pessoa@gmail.com").json()["access_token"]

    me = _me(client, token)

    assert me["google_domain"] == "gmail.com"
    assert me["google_workspace"] is False


def test_conta_com_senha_nao_mostra_dados_do_google(client):
    client.post("/auth/register", json={"name": "Pessoa", "email": "s@example.com", "password": PASSWORD})
    token = client.post("/auth/login", json={"email": "s@example.com", "password": PASSWORD}).json()["access_token"]

    me = _me(client, token)

    assert me["google_domain"] is None
    assert me["google_locale"] is None
    assert me["last_login_at"] is not None
    assert me["created_at"] is not None


def test_email_nao_verificado_pelo_google_e_recusado(client, db_session):
    _enable_google(db_session)
    claims = {"email": "nv@example.com", "name": "Sem Verificar", "email_verified": False}
    with patch("google.oauth2.id_token.verify_oauth2_token", return_value=claims):
        resp = client.post("/auth/google", json={"id_token": "fake"})

    assert resp.status_code == 401
    assert client.post("/auth/login", json={"email": "nv@example.com", "password": PASSWORD}).status_code == 401


def test_conta_google_nao_pode_alterar_o_nome(client, db_session):
    _enable_google(db_session)
    token = _google_login(client, "fixo@example.com", name="Maria Souza").json()["access_token"]

    resp = client.patch("/auth/me", json={"name": "Outro Nome"}, headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 400
    assert _me(client, token)["name"] == "Maria Souza"


def test_conta_com_senha_que_entra_pelo_google_perde_a_edicao_e_o_nome_vem_do_google(client, db_session):
    _enable_google(db_session)
    client.post("/auth/register", json={"name": "Apelido", "email": "q@example.com", "password": PASSWORD})

    token = _google_login(client, "q@example.com", name="Maria Souza").json()["access_token"]

    assert _me(client, token)["name"] == "Maria Souza"
    resp = client.patch("/auth/me", json={"name": "Outro"}, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400


def test_so_baixa_foto_de_endereco_do_google():
    assert avatar.is_allowed_picture_url("https://lh3.googleusercontent.com/a/x")
    assert not avatar.is_allowed_picture_url("http://lh3.googleusercontent.com/a/x")
    assert not avatar.is_allowed_picture_url("https://evil.example.com/a.png")
    assert not avatar.is_allowed_picture_url("https://googleusercontent.com.evil.com/a.png")
    assert avatar.download_avatar("https://evil.example.com/a.png", 1, None) is None
    assert avatar.download_avatar(None, 1, None) is None


def test_arquivo_que_nao_e_imagem_e_recusado():
    assert avatar._image_extension(b"<html>oi</html>") is None
    assert avatar._image_extension(PNG) == ".png"


def test_nome_do_google_em_maiuscula_fica_padronizado(client, db_session):
    _enable_google(db_session)
    token = _google_login(client, "caps@example.com", name="MARIA DA SILVA").json()["access_token"]
    assert _me(client, token)["name"] == "Maria da Silva"


def test_nome_padronizado():
    assert format_person_name("  JOAO   DE souza ") == "Joao de Souza"
    assert format_person_name("ana-maria d'avila") == "Ana-Maria D'Avila"
    assert format_person_name("de la cruz") == "De La Cruz"
    assert format_person_name("") == ""


def test_cadastro_e_troca_de_nome_padronizam(client):
    client.post("/auth/register", json={"name": "CARLOS PEREIRA", "email": "c@example.com", "password": PASSWORD})
    token = client.post("/auth/login", json={"email": "c@example.com", "password": PASSWORD}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/auth/me", headers=headers).json()["name"] == "Carlos Pereira"

    resp = client.patch("/auth/me", json={"name": "carlos dos SANTOS"}, headers=headers)
    assert resp.json()["name"] == "Carlos dos Santos"

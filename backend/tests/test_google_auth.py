"""Testes do login com Google via TestClient, incluindo o auto-provisionamento de conta
quando o autocadastro por email/senha (allow_registration) esta desligado."""

from unittest.mock import patch

from app.models.settings import AppSettings


def _set_settings(db_session, **kwargs):
    row = db_session.query(AppSettings).filter(AppSettings.id == 1).first()
    if not row:
        row = AppSettings(id=1)
        db_session.add(row)
    for key, value in kwargs.items():
        setattr(row, key, value)
    db_session.commit()


def _google_login(client, email: str, name: str = "Google User"):
    with patch("google.oauth2.id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = {"email": email, "name": name}
        return client.post("/auth/google", json={"id_token": "fake-token"})


def test_login_google_cria_conta_com_registration_aberto(client, db_session):
    _set_settings(db_session, google_oauth_enabled=True, google_client_id="fake-client-id", allow_registration=True)

    resp = _google_login(client, "nova@example.com")
    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_login_google_bloqueia_conta_nova_com_registration_fechado_sem_dominio_liberado(client, db_session):
    _set_settings(
        db_session,
        google_oauth_enabled=True,
        google_client_id="fake-client-id",
        allow_registration=False,
        google_allowed_domains=None,
    )

    resp = _google_login(client, "nova@example.com")
    assert resp.status_code == 403
    assert "desabilitada" in resp.json()["detail"].lower()


def test_login_google_cria_conta_com_registration_fechado_se_dominio_esta_liberado(client, db_session):
    """O bug corrigido: allow_registration=False bloqueava ATE dominios que o admin explicitamente
    liberou em google_allowed_domains -- o dominio ter sido adicionado la deve bastar."""
    _set_settings(
        db_session,
        google_oauth_enabled=True,
        google_client_id="fake-client-id",
        allow_registration=False,
        google_allowed_domains="empresa.com",
    )

    resp = _google_login(client, "nova@empresa.com")
    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_login_google_ainda_rejeita_dominio_fora_da_lista_com_registration_fechado(client, db_session):
    _set_settings(
        db_session,
        google_oauth_enabled=True,
        google_client_id="fake-client-id",
        allow_registration=False,
        google_allowed_domains="empresa.com",
    )

    resp = _google_login(client, "nova@outraempresa.com")
    assert resp.status_code == 403
    assert "dominio" in resp.json()["detail"].lower()


def test_login_google_usuario_existente_funciona_mesmo_com_registration_fechado(client, db_session, make_user):
    _set_settings(
        db_session,
        google_oauth_enabled=True,
        google_client_id="fake-client-id",
        allow_registration=False,
        google_allowed_domains=None,
    )
    make_user("ja-existe@example.com")

    resp = _google_login(client, "ja-existe@example.com")
    assert resp.status_code == 200
    assert resp.json()["access_token"]

"""Quando single_collection_redirect esta ativo, usuarios com acesso a uma unica colecao
devem ser redirecionados para ela ao entrar. A coluna e nullable no banco (migracao automatica
so adiciona colunas sem NOT NULL -- banco existente chega com NULL, nao com False)."""

from sqlalchemy import text

from app.models.settings import AppSettings


def _register_and_login(client, email: str = "admin@example.com") -> str:
    client.post("/auth/register", json={"name": "Admin", "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    return resp.json()["access_token"]


def _headers(client, email: str = "admin@example.com") -> dict:
    return {"Authorization": f"Bearer {_register_and_login(client, email)}"}


def test_default_retorna_false_no_get(client):
    resp = client.get("/settings/")

    assert resp.status_code == 200
    assert resp.json()["single_collection_redirect"] is False


def test_admin_pode_ativar_e_desativar(client):
    headers = _headers(client)

    resp = client.put("/settings/", json={"single_collection_redirect": True}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["single_collection_redirect"] is True

    resp = client.put("/settings/", json={"single_collection_redirect": False}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["single_collection_redirect"] is False


def test_ativacao_persiste_no_get(client):
    headers = _headers(client)
    client.put("/settings/", json={"single_collection_redirect": True}, headers=headers)

    resp = client.get("/settings/")

    assert resp.status_code == 200
    assert resp.json()["single_collection_redirect"] is True


def test_nao_admin_nao_pode_alterar(client):
    _headers(client)  # cria o admin primeiro
    headers_user = _headers(client, email="user@example.com")

    resp = client.put("/settings/", json={"single_collection_redirect": True}, headers=headers_user)

    assert resp.status_code == 403


def test_null_explicito_retorna_422(client):
    headers = _headers(client)

    resp = client.put("/settings/", json={"single_collection_redirect": None}, headers=headers)

    assert resp.status_code == 422


def test_coluna_null_no_banco_retorna_false_sem_500(client, db_session):
    """Simula uma linha legada onde a coluna ainda nao existia e chegou como NULL via migracao."""
    db_session.execute(text("UPDATE app_settings SET single_collection_redirect = NULL WHERE id = 1"))
    db_session.commit()

    resp = client.get("/settings/")

    assert resp.status_code == 200
    assert resp.json()["single_collection_redirect"] is False


def test_migracao_adiciona_coluna_em_tabela_sem_ela(db_session):
    """ensure_schema_up_to_date deve adicionar single_collection_redirect numa tabela que nao tem a coluna."""
    from sqlalchemy import inspect

    from app.core.schema_migrations import ensure_schema_up_to_date
    from app.core.database import Base

    engine = db_session.get_bind()

    # Remove a coluna simulando um banco antigo (SQLite nao tem DROP COLUMN antes do 3.35,
    # por isso recria a tabela sem ela usando a conexao direta).
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE app_settings_old AS "
            "SELECT id, company_name, primary_color, secondary_color, logo_url, favicon_url, "
            "login_image_url, login_layout, timezone, site_url, support_email, force_https, "
            "default_workspace_id, allow_registration, google_oauth_enabled, "
            "google_client_id, google_client_secret, google_allowed_domains "
            "FROM app_settings"
        ))
        conn.execute(text("DROP TABLE app_settings"))
        conn.execute(text("ALTER TABLE app_settings_old RENAME TO app_settings"))

    inspector = inspect(engine)
    cols_antes = {c["name"] for c in inspector.get_columns("app_settings")}
    assert "single_collection_redirect" not in cols_antes

    ensure_schema_up_to_date(engine, Base)

    inspector2 = inspect(engine)
    cols_depois = {c["name"] for c in inspector2.get_columns("app_settings")}
    assert "single_collection_redirect" in cols_depois

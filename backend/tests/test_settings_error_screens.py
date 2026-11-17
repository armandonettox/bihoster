"""Textos das telas de erro (404 e erro inesperado) personalizáveis em Configurações > Marca. Nulo ou vazio
significa "usar o texto padrão da interface"; a rota GET é pública porque a tela de erro aparece até sem login."""

import pytest
from sqlalchemy import inspect, text

from app.models.settings import AppSettings
from app.schemas.settings import ERROR_BUTTON_MAX_CHARS, ERROR_MESSAGE_MAX_CHARS, ERROR_TITLE_MAX_CHARS

CAMPOS = ("not_found_title", "not_found_message", "not_found_button", "error_title", "error_message", "error_button")


def _headers(client, email: str = "admin@example.com") -> dict:
    client.post("/auth/register", json={"name": "Admin", "email": email, "password": "SenhaForte123"})
    token = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_por_padrao_todos_os_textos_vem_nulos(client):
    corpo = client.get("/settings/").json()

    for campo in CAMPOS:
        assert corpo[campo] is None


def test_admin_grava_os_seis_textos_e_o_get_publico_devolve(client):
    headers = _headers(client)
    textos = {
        "not_found_title": "Não achamos essa página",
        "not_found_message": "Confira o endereço ou volte ao início.",
        "not_found_button": "Ir para o início",
        "error_title": "Tivemos um problema",
        "error_message": "Já estamos olhando. Tente de novo em instantes.",
        "error_button": "Tentar de novo",
    }

    resp = client.put("/settings/", json=textos, headers=headers)

    assert resp.status_code == 200
    anonimo = client.get("/settings/").json()  # sem login
    for campo, valor in textos.items():
        assert resp.json()[campo] == valor
        assert anonimo[campo] == valor


def test_texto_vazio_ou_so_com_espacos_volta_ao_padrao(client):
    headers = _headers(client)
    client.put("/settings/", json={"error_title": "Tivemos um problema", "not_found_title": "Sumiu"}, headers=headers)

    resp = client.put("/settings/", json={"error_title": "", "not_found_title": "   "}, headers=headers)

    assert resp.json()["error_title"] is None
    assert resp.json()["not_found_title"] is None


def test_null_explicito_tambem_volta_ao_padrao(client):
    headers = _headers(client)
    client.put("/settings/", json={"error_message": "Algo para apagar"}, headers=headers)

    resp = client.put("/settings/", json={"error_message": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["error_message"] is None


def test_espacos_nas_pontas_sao_tirados(client):
    headers = _headers(client)

    resp = client.put("/settings/", json={"not_found_button": "  Voltar  "}, headers=headers)

    assert resp.json()["not_found_button"] == "Voltar"


def test_mudar_um_texto_nao_mexe_nos_outros(client):
    headers = _headers(client)
    client.put("/settings/", json={"error_title": "Tivemos um problema", "error_button": "Tentar de novo"}, headers=headers)

    resp = client.put("/settings/", json={"error_title": "Outro título"}, headers=headers)

    assert resp.json()["error_title"] == "Outro título"
    assert resp.json()["error_button"] == "Tentar de novo"


def test_mudar_so_a_cor_nao_apaga_os_textos(client):
    headers = _headers(client)
    client.put("/settings/", json={"error_title": "Tivemos um problema"}, headers=headers)

    resp = client.put("/settings/", json={"primary_color": "#065f46"}, headers=headers)

    assert resp.json()["error_title"] == "Tivemos um problema"
    assert resp.json()["primary_color"] == "#065F46"


@pytest.mark.parametrize(
    "campo, limite",
    [
        ("not_found_title", ERROR_TITLE_MAX_CHARS),
        ("error_title", ERROR_TITLE_MAX_CHARS),
        ("not_found_message", ERROR_MESSAGE_MAX_CHARS),
        ("error_message", ERROR_MESSAGE_MAX_CHARS),
        ("not_found_button", ERROR_BUTTON_MAX_CHARS),
        ("error_button", ERROR_BUTTON_MAX_CHARS),
    ],
)
def test_o_limite_de_tamanho_vale_e_um_a_mais_e_recusado(client, campo, limite):
    headers = _headers(client)

    assert client.put("/settings/", json={campo: "a" * limite}, headers=headers).status_code == 200
    assert client.put("/settings/", json={campo: "a" * (limite + 1)}, headers=headers).status_code == 422


def test_nao_admin_nao_pode_alterar_os_textos(client):
    _headers(client)  # a primeira conta é a administradora
    comum = _headers(client, email="user@example.com")

    resp = client.put("/settings/", json={"error_title": "Hackeado"}, headers=comum)

    assert resp.status_code == 403
    assert client.get("/settings/").json()["error_title"] is None


def test_html_no_texto_e_guardado_como_texto_puro(client):
    """A interface mostra o texto como texto (nunca como HTML); o servidor só o guarda e devolve."""
    headers = _headers(client)

    resp = client.put("/settings/", json={"error_message": "<b>oi</b>"}, headers=headers)

    assert resp.json()["error_message"] == "<b>oi</b>"


def test_banco_antigo_sem_as_colunas_ganha_as_colunas_sozinho(db_session):
    """Instalação já rodando (tabela app_settings sem as colunas novas): o boot as acrescenta como nulas."""
    from app.core.schema_migrations import ensure_schema_up_to_date
    from app.core.database import Base

    engine = db_session.get_bind()
    with engine.begin() as conn:
        for campo in CAMPOS:
            conn.execute(text(f'ALTER TABLE app_settings DROP COLUMN "{campo}"'))
    assert not set(CAMPOS) & {c["name"] for c in inspect(engine).get_columns("app_settings")}

    ensure_schema_up_to_date(engine, Base)

    colunas = {c["name"]: c for c in inspect(engine).get_columns("app_settings")}
    for campo in CAMPOS:
        assert campo in colunas and colunas[campo]["nullable"] is True
    linha = AppSettings(id=1)
    db_session.add(linha)
    db_session.commit()
    assert all(getattr(db_session.query(AppSettings).first(), campo) is None for campo in CAMPOS)

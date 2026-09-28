"""Testes da aba Atualizacoes: comparacao de versao (unidade) e as rotas /system/version*
(via TestClient, com as chamadas ao GitHub e ao docker compose mockadas -- nada disso deve
bater na rede nem chamar subprocess de verdade num teste)."""

from unittest.mock import MagicMock, patch

from app.core import system_update
from app.core.system_update import ReleaseInfo


def _register_and_login(client, email: str, name: str = "Admin") -> str:
    client.post("/auth/register", json={"name": name, "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    return resp.json()["access_token"]


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_is_newer_compara_versoes_ignorando_prefixo_v():
    assert system_update.is_newer("1.5.0", "1.4.9")
    assert system_update.is_newer("v2.0.0", "1.9.9")
    assert not system_update.is_newer("1.4.0", "1.4.0")
    assert not system_update.is_newer("1.3.0", "1.4.0")


def test_is_newer_nunca_oferece_atualizacao_em_build_dev():
    # Build local sem tag (settings.app_version == "dev") nao tem versao de referencia real
    # pra comparar -- nunca deve dizer que ha atualizacao disponivel.
    assert not system_update.is_newer("99.0.0", "dev")


def test_version_status_sem_atualizacao_disponivel(client, monkeypatch):
    admin_token = _register_and_login(client, "admin@example.com")
    headers = _auth_headers(admin_token)

    monkeypatch.setattr(system_update.settings, "app_version", "1.0.0")
    fake_release = ReleaseInfo(version="1.0.0", name="v1.0.0", changelog="", published_at=None)
    with patch.object(system_update, "fetch_latest_release", return_value=fake_release):
        resp = client.get("/system/version", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["current_version"] == "1.0.0"
    assert body["has_update"] is False


def test_version_status_com_atualizacao_disponivel(client, monkeypatch):
    admin_token = _register_and_login(client, "admin@example.com")
    headers = _auth_headers(admin_token)

    monkeypatch.setattr(system_update.settings, "app_version", "1.0.0")
    fake_release = ReleaseInfo(version="1.4.0", name="v1.4.0", changelog="novidades", published_at=None)
    with patch.object(system_update, "fetch_latest_release", return_value=fake_release):
        resp = client.get("/system/version", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["has_update"] is True
    assert body["latest"]["version"] == "1.4.0"


def test_version_status_nao_derruba_quando_github_falha(client, monkeypatch):
    """GitHub fora do ar/rate limit nao pode derrubar a aba -- so nao mostra atualizacao."""
    import httpx

    admin_token = _register_and_login(client, "admin@example.com")
    headers = _auth_headers(admin_token)

    with patch.object(system_update, "fetch_latest_release", side_effect=httpx.HTTPError("boom")):
        resp = client.get("/system/version", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["has_update"] is False


def test_apply_update_bloqueado_quando_auto_update_desligado(client, monkeypatch):
    admin_token = _register_and_login(client, "admin@example.com")
    headers = _auth_headers(admin_token)

    monkeypatch.setattr(system_update, "is_auto_update_enabled", lambda: False)
    resp = client.post("/system/version/apply", headers=headers)

    assert resp.status_code == 403


def test_apply_update_rejeita_sem_versao_mais_nova(client, monkeypatch):
    admin_token = _register_and_login(client, "admin@example.com")
    headers = _auth_headers(admin_token)

    monkeypatch.setattr(system_update, "is_auto_update_enabled", lambda: True)
    monkeypatch.setattr(system_update.settings, "app_version", "2.0.0")
    fake_release = ReleaseInfo(version="2.0.0", name="v2.0.0", changelog="", published_at=None)
    with patch.object(system_update, "fetch_latest_release", return_value=fake_release):
        resp = client.post("/system/version/apply", headers=headers)

    assert resp.status_code == 400


def test_apply_update_dispara_quando_ha_versao_nova_e_auditoria_registrada(client, monkeypatch):
    admin_token = _register_and_login(client, "admin@example.com")
    headers = _auth_headers(admin_token)

    monkeypatch.setattr(system_update, "is_auto_update_enabled", lambda: True)
    monkeypatch.setattr(system_update.settings, "app_version", "1.0.0")
    fake_release = ReleaseInfo(version="1.5.0", name="v1.5.0", changelog="", published_at=None)
    fake_log_path = MagicMock()
    fake_log_path.name = "20260101T000000Z_v1.5.0.log"

    with patch.object(system_update, "fetch_latest_release", return_value=fake_release), patch.object(
        system_update, "apply_update", return_value=fake_log_path
    ) as mocked_apply:
        resp = client.post("/system/version/apply", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "started"
    assert body["target_version"] == "1.5.0"
    mocked_apply.assert_called_once_with("1.5.0")

    audit_resp = client.get("/audit", headers=headers)
    actions = [entry["action"] for entry in audit_resp.json()]
    assert "apply_update" in actions


def test_apply_update_nao_admin_e_bloqueado(client, monkeypatch):
    _register_and_login(client, "admin@example.com")  # primeiro usuario vira admin (bootstrap)
    viewer_token = _register_and_login(client, "viewer@example.com", name="Viewer")

    monkeypatch.setattr(system_update, "is_auto_update_enabled", lambda: True)
    resp = client.post("/system/version/apply", headers=_auth_headers(viewer_token))

    assert resp.status_code == 403

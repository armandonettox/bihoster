"""Robustez da aba Atualizacoes: cache da consulta ao GitHub (limite de 60 req/h sem token),
trava contra duas atualizacoes ao mesmo tempo, aviso quando a verificacao falha e limite de logs."""

from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.core import system_update


@pytest.fixture(autouse=True)
def _limpa_cache():
    system_update.clear_release_cache()
    yield
    system_update.clear_release_cache()


def _release_payload(tag: str = "v1.2.0") -> dict:
    return {"tag_name": tag, "name": tag, "body": "notas", "published_at": "2026-09-29T12:00:00Z"}


def _fake_response(payload, status: int = 200):
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = payload
    resp.raise_for_status.return_value = None
    return resp


def _register_and_login(client, email: str = "admin@example.com") -> str:
    client.post("/auth/register", json={"name": "Admin", "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    return resp.json()["access_token"]


def _headers(client) -> dict:
    return {"Authorization": f"Bearer {_register_and_login(client)}"}


def test_consulta_da_ultima_release_usa_cache(monkeypatch):
    with patch.object(system_update.httpx, "get", return_value=_fake_response(_release_payload())) as mocked:
        system_update.fetch_latest_release()
        system_update.fetch_latest_release()
        system_update.fetch_latest_release()

    assert mocked.call_count == 1


def test_force_ignora_o_cache():
    with patch.object(system_update.httpx, "get", return_value=_fake_response(_release_payload())) as mocked:
        system_update.fetch_latest_release()
        system_update.fetch_latest_release(force=True)

    assert mocked.call_count == 2


def test_falha_do_github_nao_e_cacheada():
    ok = _fake_response(_release_payload())
    with patch.object(system_update.httpx, "get", side_effect=[httpx.ConnectError("boom"), ok]) as mocked:
        with pytest.raises(httpx.HTTPError):
            system_update.fetch_latest_release()
        release = system_update.fetch_latest_release()

    assert release.version == "1.2.0"
    assert mocked.call_count == 2


def test_historico_usa_cache():
    payload = [_release_payload("v1.2.0"), _release_payload("v1.1.0")]
    with patch.object(system_update.httpx, "get", return_value=_fake_response(payload)) as mocked:
        first = system_update.fetch_release_history()
        second = system_update.fetch_release_history()

    assert mocked.call_count == 1
    assert [r.version for r in first] == [r.version for r in second] == ["1.2.0", "1.1.0"]


def test_status_avisa_quando_a_verificacao_falha(client, monkeypatch):
    headers = _headers(client)
    monkeypatch.setattr(system_update.settings, "app_version", "1.0.0")

    with patch.object(system_update, "fetch_latest_release", side_effect=httpx.HTTPError("boom")):
        resp = client.get("/system/version", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["has_update"] is False
    assert body["check_failed"] is True


def test_status_sem_falha_nao_marca_check_failed(client, monkeypatch):
    headers = _headers(client)
    monkeypatch.setattr(system_update.settings, "app_version", "1.0.0")
    release = system_update.ReleaseInfo(version="1.0.0", name="v1.0.0", changelog="", published_at=None)

    with patch.object(system_update, "fetch_latest_release", return_value=release):
        resp = client.get("/system/version", headers=headers)

    assert resp.json()["check_failed"] is False


def _prepara_deploy(tmp_path, monkeypatch):
    deploy = tmp_path / "deploy"
    deploy.mkdir()
    (deploy / "docker-compose.yml").write_text("services: {}\n")
    monkeypatch.setenv("DEPLOY_DIR", str(deploy))
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))


def test_segunda_atualizacao_enquanto_a_primeira_roda_e_recusada(tmp_path, monkeypatch):
    _prepara_deploy(tmp_path, monkeypatch)

    with patch.object(system_update.subprocess, "Popen") as popen:
        system_update.apply_update("1.2.0")
        with pytest.raises(system_update.UpdateAlreadyRunning):
            system_update.apply_update("1.2.0")

    assert popen.call_count == 1


def test_trava_velha_e_ignorada(tmp_path, monkeypatch):
    import os
    import time

    _prepara_deploy(tmp_path, monkeypatch)
    lock = system_update._update_log_dir() / "apply.lock"
    lock.write_text("")
    velho = time.time() - system_update.APPLY_LOCK_STALE_SECONDS - 60
    os.utime(lock, (velho, velho))

    with patch.object(system_update.subprocess, "Popen") as popen:
        system_update.apply_update("1.2.0")

    assert popen.call_count == 1


def test_falha_ao_disparar_libera_a_trava(tmp_path, monkeypatch):
    _prepara_deploy(tmp_path, monkeypatch)

    with patch.object(system_update.subprocess, "Popen", side_effect=OSError("sem docker")):
        with pytest.raises(OSError):
            system_update.apply_update("1.2.0")

    # Nao ficou trava presa: uma nova tentativa passa
    with patch.object(system_update.subprocess, "Popen") as popen:
        system_update.apply_update("1.2.0")
    assert popen.call_count == 1


def test_endpoint_apply_devolve_409_quando_ja_ha_atualizacao_em_andamento(client, monkeypatch):
    headers = _headers(client)
    monkeypatch.setattr(system_update, "is_auto_update_enabled", lambda: True)
    monkeypatch.setattr(system_update.settings, "app_version", "1.0.0")
    release = system_update.ReleaseInfo(version="1.2.0", name="v1.2.0", changelog="", published_at=None)

    with patch.object(system_update, "fetch_latest_release", return_value=release), patch.object(
        system_update, "apply_update", side_effect=system_update.UpdateAlreadyRunning("em andamento")
    ):
        resp = client.post("/system/version/apply", headers=headers)

    assert resp.status_code == 409


def test_logs_limitados_e_truncados(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    log_dir = system_update._update_log_dir()
    for i in range(15):
        (log_dir / f"2026090{i % 10}T00000{i:02d}Z_v1.0.{i}.log").write_text("x" * 50_000)

    logs = system_update.list_update_logs()

    assert len(logs) == system_update.MAX_UPDATE_LOGS
    assert all(len(entry["content"]) <= system_update.MAX_LOG_CHARS + 200 for entry in logs)

"""Cobre o loop de redirect atras de reverse proxy: com TRUST_PROXY_HEADERS=false (padrao),
X-Forwarded-Proto e ignorado (comportamento antigo, sem proxy). Com TRUST_PROXY_HEADERS=true,
o backend confia no header do proxy e para de redirecionar quando ele diz "https".

`_is_force_https_enabled` (app/main.py) abre sua propria sessao via `SessionLocal` direto (nao
via `get_db`), entao o override de banco do fixture `client` nao alcanca essa checagem -- por
isso mockamos a funcao direto em vez de gravar a linha de AppSettings no `db_session`."""

from unittest.mock import patch

from app.core.config import settings


def test_sem_trust_proxy_headers_redireciona_mesmo_com_x_forwarded_proto_https(client, monkeypatch):
    monkeypatch.setattr(settings, "trust_proxy_headers", False)

    with patch("app.main._is_force_https_enabled", return_value=True):
        resp = client.get(
            "/health",
            headers={"host": "bi.example.com", "x-forwarded-proto": "https"},
            follow_redirects=False,
        )

    assert resp.status_code == 301


def test_com_trust_proxy_headers_nao_entra_em_loop_quando_proxy_diz_https(client, monkeypatch):
    monkeypatch.setattr(settings, "trust_proxy_headers", True)

    with patch("app.main._is_force_https_enabled", return_value=True):
        resp = client.get(
            "/health",
            headers={"host": "bi.example.com", "x-forwarded-proto": "https"},
            follow_redirects=False,
        )

    assert resp.status_code == 200


def test_com_trust_proxy_headers_ainda_redireciona_quando_proxy_diz_http(client, monkeypatch):
    monkeypatch.setattr(settings, "trust_proxy_headers", True)

    with patch("app.main._is_force_https_enabled", return_value=True):
        resp = client.get(
            "/health",
            headers={"host": "bi.example.com", "x-forwarded-proto": "http"},
            follow_redirects=False,
        )

    assert resp.status_code == 301

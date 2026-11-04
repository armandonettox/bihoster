"""Desempenho das chamadas ao Power BI e medicao de tempo das requisicoes:
- dados estaticos do relatorio (URL de embed, RLS) guardados em cache, sem repetir a cada usuario;
- um unico cliente HTTP compartilhado (conexao reaproveitada) em vez de uma conexao nova por chamada;
- cabecalho Server-Timing e aviso de requisicao lenta."""

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx

from app.core import powerbi as powerbi_core
from app.routers import powerbi as embed_router


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _token():
    return {"token": "tok", "expiration": _iso(datetime.now(timezone.utc) + timedelta(minutes=60))}


def _setup(client, dataset_id: str | None = None):
    client.post("/auth/register", json={"name": "Admin", "email": "admin@example.com", "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": "admin@example.com", "password": "SenhaForte123"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    workspace = client.post("/workspaces/", json={"name": "Comercial"}, headers=headers).json()
    conn = client.post(
        "/powerbi-connections/",
        json={"name": "Conta", "tenant_id": "t1", "client_id": "c1", "client_secret": "s1"},
        headers=headers,
    ).json()
    body = {
        "name": "Vendas",
        "powerbi_connection_id": conn["id"],
        "pbi_workspace_id": "pbi-ws",
        "pbi_report_id": "pbi-rel",
    }
    if dataset_id:
        body["pbi_dataset_id"] = dataset_id
    report = client.post(f"/workspaces/{workspace['id']}/reports/", json=body, headers=headers).json()
    return headers, workspace, report


def _embed(client, headers, workspace, report, *, details, identity=None, generate=None):
    """Chama o endpoint de embed com o Power BI mockado; devolve a resposta e os mocks."""
    url = f"/workspaces/{workspace['id']}/powerbi/reports/{report['id']}/embed"
    with patch.object(powerbi_core, "get_report_details", details), patch.object(
        powerbi_core, "dataset_requires_effective_identity", identity or MagicMock(return_value=False)
    ), patch.object(powerbi_core, "generate_embed_token", generate or MagicMock(return_value=_token())):
        return client.get(url, headers=headers)


class TestCacheDosDadosEstaticos:
    def test_url_de_embed_e_buscada_uma_vez_mesmo_com_token_novo(self, client):
        headers, workspace, report = _setup(client)
        details = MagicMock(return_value={"embedUrl": "https://embed/x"})
        generate = MagicMock(return_value=_token())

        _embed(client, headers, workspace, report, details=details, generate=generate)
        # Outro usuario (ou token vencido): o cache do token nao vale, mas a URL ja e conhecida
        embed_router._embed_cache.clear()
        resp = _embed(client, headers, workspace, report, details=details, generate=generate)

        assert resp.status_code == 200
        assert resp.json()["embed_url"] == "https://embed/x"
        assert details.call_count == 1
        assert generate.call_count == 2

    def test_pergunta_pelo_rls_do_dataset_uma_vez_so(self, client):
        headers, workspace, report = _setup(client, dataset_id="ds-1")
        details = MagicMock(return_value={"embedUrl": "https://embed/x"})
        identity = MagicMock(return_value=False)

        _embed(client, headers, workspace, report, details=details, identity=identity)
        embed_router._embed_cache.clear()
        _embed(client, headers, workspace, report, details=details, identity=identity)

        assert identity.call_count == 1

    def test_editar_o_relatorio_faz_buscar_de_novo(self, client):
        headers, workspace, report = _setup(client)
        details = MagicMock(return_value={"embedUrl": "https://embed/x"})

        _embed(client, headers, workspace, report, details=details)
        embed_router.invalidate_embed_cache(workspace["id"], report["id"])
        _embed(client, headers, workspace, report, details=details)

        assert details.call_count == 2

    def test_token_recusado_descarta_os_dados_guardados(self, client):
        headers, workspace, report = _setup(client)
        details = MagicMock(return_value={"embedUrl": "https://embed/x"})
        recusa = MagicMock(side_effect=powerbi_core.PowerBIError("RLS mudou"))

        resp = _embed(client, headers, workspace, report, details=details, generate=recusa)
        assert resp.status_code == 502

        # A proxima tentativa nao pode reaproveitar um dado que pode estar velho
        resp = _embed(client, headers, workspace, report, details=details)
        assert resp.status_code == 200
        assert details.call_count == 2


class TestClienteHttpCompartilhado:
    def test_chamadas_usam_o_mesmo_cliente_e_guardam_o_token_da_azure(self):
        powerbi_core._cached_tokens.clear()
        conexao = SimpleNamespace(id=900, tenant_id="t", client_id="c", client_secret="s")
        token = MagicMock(status_code=200, json=MagicMock(return_value={"access_token": "tok", "expires_in": 3600}))
        resposta = MagicMock(status_code=200, json=MagicMock(return_value={"embedUrl": "u"}))

        with patch.object(powerbi_core._http, "post", return_value=token) as post, patch.object(
            powerbi_core._http, "get", return_value=resposta
        ) as get, patch("httpx.get", side_effect=AssertionError("httpx.get solto cria conexao nova")), patch(
            "httpx.post", side_effect=AssertionError("httpx.post solto cria conexao nova")
        ):
            powerbi_core.get_report_details(conexao, "ws", "rel-1")
            powerbi_core.get_report_details(conexao, "ws", "rel-2")

        assert get.call_count == 2
        assert post.call_count == 1  # o token da Azure e pedido uma vez e reaproveitado
        powerbi_core.invalidate_token_cache(900)

    def test_varias_threads_com_token_vencido_pedem_o_token_da_azure_uma_vez_so(self):
        powerbi_core._cached_tokens.clear()
        conexao = SimpleNamespace(id=901, tenant_id="t", client_id="c", client_secret="s")

        def resposta_lenta(*args, **kwargs):
            time.sleep(0.2)  # tempo pra as outras threads chegarem enquanto a primeira ainda pede
            return MagicMock(status_code=200, json=MagicMock(return_value={"access_token": "tok", "expires_in": 3600}))

        with patch.object(powerbi_core._http, "post", side_effect=resposta_lenta) as post:
            with ThreadPoolExecutor(max_workers=8) as pool:
                tokens = list(pool.map(lambda _: powerbi_core._get_aad_token(conexao), range(8)))

        assert set(tokens) == {"tok"}
        assert post.call_count == 1
        powerbi_core.invalidate_token_cache(901)

    def test_cliente_reaproveita_conexoes_abertas(self):
        assert isinstance(powerbi_core._http, httpx.Client)
        assert powerbi_core._http.timeout.read == 30


class TestTempoDasRequisicoes:
    def test_resposta_traz_o_cabecalho_server_timing(self, client):
        resp = client.get("/health")

        assert resp.status_code == 200
        assert resp.headers["server-timing"].startswith("app;dur=")

    def test_requisicao_lenta_vai_para_o_log_sem_query_string(self, client, caplog):
        with patch("app.main.SLOW_REQUEST_MS", 0), caplog.at_level(logging.WARNING, logger="app.main"):
            client.get("/health?token=segredo")

        mensagens = " ".join(r.getMessage() for r in caplog.records)
        assert "requisicao lenta: GET /health" in mensagens
        assert "segredo" not in mensagens

    def test_requisicao_rapida_nao_gera_aviso(self, client, caplog):
        with caplog.at_level(logging.WARNING, logger="app.main"):
            client.get("/health")

        assert not [r for r in caplog.records if "requisicao lenta" in r.getMessage()]

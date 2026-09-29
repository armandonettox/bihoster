"""Embed token: a API devolve quando ele expira e o cache nunca entrega um token proximo do
vencimento. Antes a expiracao do Power BI era descartada e o cache guardava o token por 50 min
fixos, entao um usuario podia receber um token com ~10 min de vida (ou ate ja vencido, se o
token gerado tivesse validade menor que 50 min), e o frontend nao tinha como agendar a renovacao."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.core import powerbi as powerbi_core
from app.routers import powerbi as embed_router


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _register_and_login(client, email: str = "admin@example.com") -> str:
    client.post("/auth/register", json={"name": "Admin", "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    return resp.json()["access_token"]


def _setup(client):
    headers = {"Authorization": f"Bearer {_register_and_login(client)}"}
    workspace = client.post("/workspaces/", json={"name": "Comercial"}, headers=headers).json()
    conn = client.post(
        "/powerbi-connections/",
        json={"name": "Conta", "tenant_id": "t1", "client_id": "c1", "client_secret": "s1"},
        headers=headers,
    ).json()
    report = client.post(
        f"/workspaces/{workspace['id']}/reports/",
        json={
            "name": "Vendas",
            "powerbi_connection_id": conn["id"],
            "pbi_workspace_id": "pbi-ws",
            "pbi_report_id": "pbi-rel",
        },
        headers=headers,
    ).json()
    return headers, workspace, report


def _embed(client, headers, workspace, report, token_response):
    """Chama o endpoint de embed com o Power BI mockado; devolve (resposta, chamadas ao GenerateToken)."""
    with patch.object(powerbi_core, "get_report_details", return_value={"embedUrl": "https://embed/x"}), patch.object(
        powerbi_core, "generate_embed_token", return_value=token_response
    ) as gen:
        resp = client.get(f"/workspaces/{workspace['id']}/powerbi/reports/{report['id']}/embed", headers=headers)
    return resp, gen.call_count


def _limpa():
    embed_router._embed_cache.clear()
    embed_router._refresh_info_cache.clear()


def test_embed_devolve_expires_at_em_utc_com_z(client):
    _limpa()
    headers, workspace, report = _setup(client)
    expira = datetime.now(timezone.utc) + timedelta(minutes=60)

    resp, _ = _embed(client, headers, workspace, report, {"token": "tok", "expiration": _iso(expira)})

    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"] == "tok"
    assert body["expires_at"].endswith("Z")
    got = datetime.fromisoformat(body["expires_at"].replace("Z", "+00:00"))
    assert abs((got - expira).total_seconds()) < 1
    _limpa()


def test_embed_sem_expiration_na_resposta_usa_padrao_de_uma_hora(client):
    """Se o Power BI nao mandar `expiration`, assume 1h (validade padrao do embed token)."""
    _limpa()
    headers, workspace, report = _setup(client)

    resp, _ = _embed(client, headers, workspace, report, {"token": "tok"})

    got = datetime.fromisoformat(resp.json()["expires_at"].replace("Z", "+00:00"))
    restante = (got - datetime.now(timezone.utc)).total_seconds()
    assert 55 * 60 < restante <= 60 * 60
    _limpa()


def test_cache_vale_ate_cinco_minutos_antes_da_expiracao(client):
    _limpa()
    headers, workspace, report = _setup(client)
    expira = datetime.now(timezone.utc) + timedelta(minutes=60)

    _, chamadas = _embed(client, headers, workspace, report, {"token": "tok", "expiration": _iso(expira)})
    assert chamadas == 1

    cache_expira_em = next(iter(embed_router._embed_cache.values()))[0]
    margem = (expira - cache_expira_em).total_seconds()
    assert 4.9 * 60 <= margem <= 5.1 * 60

    # Segunda chamada dentro da validade vem do cache
    _, chamadas2 = _embed(client, headers, workspace, report, {"token": "outro", "expiration": _iso(expira)})
    assert chamadas2 == 0
    _limpa()


def test_token_com_pouca_validade_nao_e_cacheado(client):
    """Token que vence em menos de 5 min nao entra no cache: a proxima chamada gera outro."""
    _limpa()
    headers, workspace, report = _setup(client)
    expira = datetime.now(timezone.utc) + timedelta(minutes=3)

    _embed(client, headers, workspace, report, {"token": "curto", "expiration": _iso(expira)})
    assert not embed_router._embed_cache

    _, chamadas = _embed(client, headers, workspace, report, {"token": "curto2", "expiration": _iso(expira)})
    assert chamadas == 1
    _limpa()


def test_cache_mantem_o_mesmo_expires_at_do_token_cacheado(client):
    _limpa()
    headers, workspace, report = _setup(client)
    expira = datetime.now(timezone.utc) + timedelta(minutes=60)

    first, _ = _embed(client, headers, workspace, report, {"token": "tok", "expiration": _iso(expira)})
    second, _ = _embed(client, headers, workspace, report, {"token": "x", "expiration": _iso(expira)})

    assert first.json()["expires_at"] == second.json()["expires_at"]
    assert first.json()["access_token"] == second.json()["access_token"] == "tok"
    _limpa()


def test_parser_da_expiracao_aceita_os_formatos_do_power_bi():
    from app.routers.powerbi import _parse_token_expiration as parse

    esperado = datetime(2026, 9, 29, 20, 0, 0, tzinfo=timezone.utc)
    assert parse("2026-09-29T20:00:00Z") == esperado
    # O Power BI manda 7 casas de fracao de segundo; o Python le no maximo 6
    assert parse("2026-09-29T20:00:00.1234567Z") == esperado.replace(microsecond=123456)
    assert parse("2026-09-29T17:00:00-03:00") == esperado
    # Sem fuso: assume UTC
    assert parse("2026-09-29T20:00:00") == esperado


def test_parser_da_expiracao_cai_na_validade_padrao_com_valor_invalido():
    from app.routers.powerbi import _parse_token_expiration as parse

    for invalido in ("lixo", "", None):
        restante = (parse(invalido) - datetime.now(timezone.utc)).total_seconds()
        # Tolerancia de 1s: o parser le o relogio um instante antes deste calculo
        assert 59 * 60 < restante <= 60 * 60 + 1

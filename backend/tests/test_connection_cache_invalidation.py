"""Editar ou excluir uma conta do Power BI precisa limpar TODOS os caches derivados dela
(catalogo de workspaces/relatorios/paginas, token de embed e info de atualizacao dos relatorios
que usam a conta). Antes so o token do Azure AD era limpo: depois de trocar tenant/credenciais
o editor via por ate 5 minutos os workspaces da conta antiga, e o id de uma conta apagada
podia ser reaproveitado pelo SQLite e herdar a lista em cache."""

from datetime import datetime, timedelta, timezone

from app.routers import powerbi as embed_router
from app.routers import powerbi_catalog


def _future():
    return datetime.now(timezone.utc) + timedelta(minutes=5)


def _register_and_login(client, email: str = "admin@example.com") -> str:
    client.post("/auth/register", json={"name": "Admin", "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    return resp.json()["access_token"]


def _clear_caches():
    powerbi_catalog._workspaces_cache.clear()
    powerbi_catalog._reports_cache.clear()
    powerbi_catalog._pages_cache.clear()
    embed_router._embed_cache.clear()
    embed_router._refresh_info_cache.clear()


def _seed_caches(connection_id: int, other_connection_id: int, workspace_id: int, report_id: int):
    powerbi_catalog._workspaces_cache[connection_id] = (_future(), ["ws-velho"])
    powerbi_catalog._reports_cache[(connection_id, "pbi-ws")] = (_future(), ["rel-velho"])
    powerbi_catalog._pages_cache[(connection_id, "pbi-ws", "pbi-rel")] = (_future(), ["pag-velha"])
    # Cache de OUTRA conta: nao pode ser tocado
    powerbi_catalog._workspaces_cache[other_connection_id] = (_future(), ["ws-outra-conta"])
    embed_router._embed_cache[(workspace_id, report_id, 1)] = (_future(), object())
    embed_router._refresh_info_cache[(workspace_id, report_id)] = (_future(), {"x": 1})


def _setup(client):
    headers = {"Authorization": f"Bearer {_register_and_login(client)}"}
    workspace = client.post("/workspaces/", json={"name": "Comercial"}, headers=headers).json()
    conn = client.post(
        "/powerbi-connections/",
        json={"name": "Conta A", "tenant_id": "t1", "client_id": "c1", "client_secret": "s1"},
        headers=headers,
    ).json()
    other = client.post(
        "/powerbi-connections/",
        json={"name": "Conta B", "tenant_id": "t2", "client_id": "c2", "client_secret": "s2"},
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
    return headers, workspace, conn, other, report


def test_editar_conta_limpa_catalogo_embed_e_info_de_atualizacao(client):
    _clear_caches()
    headers, workspace, conn, other, report = _setup(client)
    _seed_caches(conn["id"], other["id"], workspace["id"], report["id"])

    resp = client.put(f"/powerbi-connections/{conn['id']}", json={"tenant_id": "novo-tenant"}, headers=headers)

    assert resp.status_code == 200
    assert conn["id"] not in powerbi_catalog._workspaces_cache
    assert (conn["id"], "pbi-ws") not in powerbi_catalog._reports_cache
    assert (conn["id"], "pbi-ws", "pbi-rel") not in powerbi_catalog._pages_cache
    assert (workspace["id"], report["id"], 1) not in embed_router._embed_cache
    assert (workspace["id"], report["id"]) not in embed_router._refresh_info_cache
    # A outra conta continua com o cache dela
    assert other["id"] in powerbi_catalog._workspaces_cache
    _clear_caches()


def test_excluir_conta_limpa_o_catalogo_dela(client):
    _clear_caches()
    headers, workspace, conn, other, report = _setup(client)
    # Libera a conta: exclusao e bloqueada enquanto algum relatorio a usa
    client.put(
        f"/workspaces/{workspace['id']}/reports/{report['id']}",
        json={"powerbi_connection_id": other["id"]},
        headers=headers,
    )
    _seed_caches(conn["id"], other["id"], workspace["id"], report["id"])

    resp = client.delete(f"/powerbi-connections/{conn['id']}", headers=headers)

    assert resp.status_code == 204
    assert conn["id"] not in powerbi_catalog._workspaces_cache
    assert (conn["id"], "pbi-ws") not in powerbi_catalog._reports_cache
    assert (conn["id"], "pbi-ws", "pbi-rel") not in powerbi_catalog._pages_cache
    assert other["id"] in powerbi_catalog._workspaces_cache
    _clear_caches()

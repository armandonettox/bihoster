"""Validacao dos campos obrigatorios de Report: {"campo": null} ou nome em branco devem dar 422,
nao quebrar com IntegrityError (500) no commit."""

import pytest


def _register_and_login(client, email: str = "admin@example.com") -> str:
    client.post("/auth/register", json={"name": "Admin", "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    return resp.json()["access_token"]


def _setup(client):
    headers = {"Authorization": f"Bearer {_register_and_login(client)}"}
    workspace = client.post("/workspaces/", json={"name": "Comercial"}, headers=headers).json()
    connection = client.post(
        "/powerbi-connections/",
        json={"name": "Conta Teste", "tenant_id": "t1", "client_id": "c1", "client_secret": "s1"},
        headers=headers,
    ).json()
    report = client.post(
        f"/workspaces/{workspace['id']}/reports/",
        json={
            "name": "Vendas",
            "powerbi_connection_id": connection["id"],
            "pbi_workspace_id": "pbi-ws-1",
            "pbi_report_id": "pbi-report-1",
            "pbi_page_name": "ReportSection1",
        },
        headers=headers,
    ).json()
    return headers, workspace, report


@pytest.mark.parametrize("field", ["name", "pbi_workspace_id", "pbi_report_id", "display_type"])
def test_editar_relatorio_com_campo_obrigatorio_nulo_da_422(client, field):
    headers, workspace, report = _setup(client)

    resp = client.put(
        f"/workspaces/{workspace['id']}/reports/{report['id']}",
        json={field: None},
        headers=headers,
    )

    assert resp.status_code == 422
    # O relatorio continua intacto
    after = client.get(f"/workspaces/{workspace['id']}/reports/{report['id']}", headers=headers).json()
    assert after[field] == report[field]


@pytest.mark.parametrize("field", ["name", "pbi_workspace_id", "pbi_report_id"])
def test_editar_relatorio_com_texto_em_branco_da_422(client, field):
    headers, workspace, report = _setup(client)

    resp = client.put(
        f"/workspaces/{workspace['id']}/reports/{report['id']}",
        json={field: "   "},
        headers=headers,
    )

    assert resp.status_code == 422


def test_criar_relatorio_com_nome_em_branco_da_422(client):
    headers, workspace, report = _setup(client)

    resp = client.post(
        f"/workspaces/{workspace['id']}/reports/",
        json={
            "name": "   ",
            "powerbi_connection_id": report["powerbi_connection_id"],
            "pbi_workspace_id": "pbi-ws-1",
            "pbi_report_id": "pbi-report-1",
        },
        headers=headers,
    )

    assert resp.status_code == 422


def test_editar_relatorio_limpa_aba_com_nulo_explicito(client):
    """pbi_page_name e nullable: null explicito significa 'relatorio inteiro' e deve continuar valendo."""
    headers, workspace, report = _setup(client)
    assert report["pbi_page_name"] == "ReportSection1"

    resp = client.put(
        f"/workspaces/{workspace['id']}/reports/{report['id']}",
        json={"pbi_page_name": None},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["pbi_page_name"] is None


def test_editar_relatorio_remove_espacos_do_nome(client):
    headers, workspace, report = _setup(client)

    resp = client.put(
        f"/workspaces/{workspace['id']}/reports/{report['id']}",
        json={"name": "  Vendas 2026  "},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["name"] == "Vendas 2026"

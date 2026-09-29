"""Testes da selecao de aba (pagina) especifica de um relatorio publicado: listagem de
paginas do catalogo, persistencia em Report.pbi_page_name e propagacao pro embed config."""

from unittest.mock import patch

from app.core import powerbi as powerbi_core


def _register_and_login(client, email: str = "admin@example.com") -> str:
    client.post("/auth/register", json={"name": "Admin", "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    return resp.json()["access_token"]


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_workspace_and_connection(client, headers):
    workspace = client.post("/workspaces/", json={"name": "Comercial"}, headers=headers).json()
    connection = client.post(
        "/powerbi-connections/",
        json={"name": "Conta Teste", "tenant_id": "t1", "client_id": "c1", "client_secret": "s1"},
        headers=headers,
    ).json()
    return workspace, connection


def test_lista_paginas_do_relatorio_publicado(client):
    token = _register_and_login(client)
    headers = _auth_headers(token)
    _, connection = _make_workspace_and_connection(client, headers)

    fake_pages = [
        {"name": "ReportSection1", "displayName": "Visao Geral"},
        {"name": "ReportSection2", "displayName": "Detalhes"},
    ]
    with patch.object(powerbi_core, "list_pages", return_value=fake_pages):
        resp = client.get(
            f"/powerbi/connections/{connection['id']}/workspaces/pbi-ws-1/reports/pbi-report-1/pages",
            headers=headers,
        )

    assert resp.status_code == 200
    assert resp.json() == [
        {"name": "ReportSection1", "display_name": "Visao Geral"},
        {"name": "ReportSection2", "display_name": "Detalhes"},
    ]


def test_criar_relatorio_com_aba_especifica_persiste_pbi_page_name(client):
    token = _register_and_login(client)
    headers = _auth_headers(token)
    workspace, connection = _make_workspace_and_connection(client, headers)

    resp = client.post(
        f"/workspaces/{workspace['id']}/reports/",
        json={
            "name": "Vendas -- Visao Geral",
            "powerbi_connection_id": connection["id"],
            "pbi_workspace_id": "pbi-ws-1",
            "pbi_report_id": "pbi-report-1",
            "pbi_page_name": "ReportSection1",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["pbi_page_name"] == "ReportSection1"


def test_relatorio_sem_aba_especifica_pbi_page_name_e_none(client):
    token = _register_and_login(client)
    headers = _auth_headers(token)
    workspace, connection = _make_workspace_and_connection(client, headers)

    resp = client.post(
        f"/workspaces/{workspace['id']}/reports/",
        json={
            "name": "Vendas completas",
            "powerbi_connection_id": connection["id"],
            "pbi_workspace_id": "pbi-ws-1",
            "pbi_report_id": "pbi-report-1",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["pbi_page_name"] is None


def test_editar_relatorio_para_voltar_a_exibir_relatorio_inteiro(client):
    token = _register_and_login(client)
    headers = _auth_headers(token)
    workspace, connection = _make_workspace_and_connection(client, headers)

    report = client.post(
        f"/workspaces/{workspace['id']}/reports/",
        json={
            "name": "Vendas -- Visao Geral",
            "powerbi_connection_id": connection["id"],
            "pbi_workspace_id": "pbi-ws-1",
            "pbi_report_id": "pbi-report-1",
            "pbi_page_name": "ReportSection1",
        },
        headers=headers,
    ).json()

    resp = client.put(
        f"/workspaces/{workspace['id']}/reports/{report['id']}",
        json={"pbi_page_name": None},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["pbi_page_name"] is None


def test_embed_config_propaga_page_name_do_relatorio(client):
    token = _register_and_login(client)
    headers = _auth_headers(token)
    workspace, connection = _make_workspace_and_connection(client, headers)

    report = client.post(
        f"/workspaces/{workspace['id']}/reports/",
        json={
            "name": "Vendas -- Visao Geral",
            "powerbi_connection_id": connection["id"],
            "pbi_workspace_id": "pbi-ws-1",
            "pbi_report_id": "pbi-report-1",
            "pbi_page_name": "ReportSection1",
        },
        headers=headers,
    ).json()

    with patch.object(
        powerbi_core, "get_report_details", return_value={"embedUrl": "https://fake/embed"}
    ), patch.object(
        powerbi_core, "generate_embed_token", return_value={"token": "fake-token"}
    ):
        resp = client.get(
            f"/workspaces/{workspace['id']}/powerbi/reports/{report['id']}/embed",
            headers=headers,
        )

    assert resp.status_code == 200
    assert resp.json()["page_name"] == "ReportSection1"

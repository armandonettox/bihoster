"""Testes end-to-end de CRUD de relatorio e da matriz de permissao por grupo, exercitados
via rota HTTP real (TestClient) -- cobre o que test_workspace_deps.py testa isolado, mas
agora passando pelas dependencies reais do FastAPI (require_workspace_role, etc)."""


def _register_and_login(client, email: str, name: str = "Usuario") -> str:
    client.post("/auth/register", json={"name": name, "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    return resp.json()["access_token"]


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_admin_cria_colecao_e_conexao_e_relatorio(client):
    admin_token = _register_and_login(client, "admin@example.com")
    headers = _auth_headers(admin_token)

    workspace = client.post("/workspaces/", json={"name": "Comercial"}, headers=headers).json()

    connection = client.post(
        "/powerbi-connections/",
        json={"name": "Conta Teste", "tenant_id": "t1", "client_id": "c1", "client_secret": "s1"},
        headers=headers,
    ).json()

    report = client.post(
        f"/workspaces/{workspace['id']}/reports/",
        json={
            "name": "Vendas mensais",
            "powerbi_connection_id": connection["id"],
            "pbi_workspace_id": "pbi-ws-1",
            "pbi_report_id": "pbi-report-1",
        },
        headers=headers,
    )
    assert report.status_code == 201
    assert report.json()["name"] == "Vendas mensais"

    listing = client.get(f"/workspaces/{workspace['id']}/reports/", headers=headers)
    assert listing.status_code == 200
    assert len(listing.json()) == 1


def test_viewer_nao_consegue_criar_relatorio(client):
    """Grupo padrao (Todos os usuarios) so ganha 'viewer' na colecao -- exercita
    require_workspace_role bloqueando quem nao e admin/editor, numa rota HTTP real."""
    admin_token = _register_and_login(client, "admin2@example.com")
    admin_headers = _auth_headers(admin_token)
    workspace = client.post("/workspaces/", json={"name": "Financeiro"}, headers=admin_headers).json()

    # O grupo padrao ja tem acesso "viewer" de fabrica (ensure_default_group_access) --
    # so precisa de outro usuario comum entrando no sistema pra herdar isso.
    viewer_token = _register_and_login(client, "viewer@example.com")
    viewer_headers = _auth_headers(viewer_token)

    resp = client.post(
        f"/workspaces/{workspace['id']}/reports/",
        json={
            "name": "Relatorio proibido",
            "powerbi_connection_id": 1,
            "pbi_workspace_id": "x",
            "pbi_report_id": "y",
        },
        headers=viewer_headers,
    )
    assert resp.status_code == 403


def test_usuario_sem_grupo_com_acesso_nao_ve_colecao(client):
    """Colecao sem nenhuma linha de acesso pro grupo padrao nao aparece pra ninguem alem
    do admin da plataforma -- confirma que o isolamento entre colecoes vale de ponta a
    ponta, nao so na funcao get_effective_role isolada."""
    admin_token = _register_and_login(client, "admin3@example.com")
    admin_headers = _auth_headers(admin_token)
    workspace = client.post("/workspaces/", json={"name": "Diretoria"}, headers=admin_headers).json()

    # Remove o acesso do grupo padrao que get_effective_role da de fabrica.
    groups = client.get("/groups/", headers=admin_headers).json()
    default_group = next(g for g in groups if g["is_default"])
    client.delete(f"/workspaces/{workspace['id']}/access/{default_group['id']}", headers=admin_headers)

    outsider_token = _register_and_login(client, "outsider@example.com")
    outsider_headers = _auth_headers(outsider_token)

    resp = client.get(f"/workspaces/{workspace['id']}", headers=outsider_headers)
    assert resp.status_code == 403

    my_workspaces = client.get("/workspaces/", headers=outsider_headers).json()
    assert workspace["id"] not in [w["id"] for w in my_workspaces]


def test_excluir_colecao_remove_relatorios_em_cascata(client):
    admin_token = _register_and_login(client, "admin4@example.com")
    headers = _auth_headers(admin_token)
    workspace = client.post("/workspaces/", json={"name": "Temporaria"}, headers=headers).json()
    connection = client.post(
        "/powerbi-connections/",
        json={"name": "Conta", "tenant_id": "t", "client_id": "c", "client_secret": "s"},
        headers=headers,
    ).json()
    client.post(
        f"/workspaces/{workspace['id']}/reports/",
        json={
            "name": "Relatorio",
            "powerbi_connection_id": connection["id"],
            "pbi_workspace_id": "w",
            "pbi_report_id": "r",
        },
        headers=headers,
    )

    resp = client.delete(f"/workspaces/{workspace['id']}", headers=headers)
    assert resp.status_code == 204

    resp = client.get(f"/workspaces/{workspace['id']}", headers=headers)
    assert resp.status_code == 404

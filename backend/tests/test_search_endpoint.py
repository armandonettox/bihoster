"""Testes da rota GET /search/: ranking, colecoes nos resultados, acento e controle de acesso."""


def _register_and_login(client, email: str) -> dict:
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _make_connection(client, headers) -> dict:
    return client.post(
        "/powerbi-connections/",
        json={"name": "Conta Teste", "tenant_id": "t1", "client_id": "c1", "client_secret": "s1"},
        headers=headers,
    ).json()


def _make_workspace(client, headers, name: str) -> dict:
    return client.post("/workspaces/", json={"name": name}, headers=headers).json()


def _make_report(client, headers, workspace: dict, connection: dict, name: str, display_type: str = "relatorio"):
    resp = client.post(
        f"/workspaces/{workspace['id']}/reports/",
        json={
            "name": name,
            "powerbi_connection_id": connection["id"],
            "pbi_workspace_id": "pbi-ws-1",
            "pbi_report_id": "pbi-report-1",
            "display_type": display_type,
        },
        headers=headers,
    )
    assert resp.status_code == 201
    return resp.json()


def _search(client, headers, q: str) -> list[dict]:
    resp = client.get("/search/", params={"q": q}, headers=headers)
    assert resp.status_code == 200
    return resp.json()


def test_resultados_ordenados_por_relevancia_e_nao_pela_ordem_do_banco(client):
    headers = _register_and_login(client, "admin@example.com")
    connection = _make_connection(client, headers)
    workspace = _make_workspace(client, headers, "Comercial")
    # Criados de proposito do pior pro melhor casamento
    _make_report(client, headers, workspace, connection, "Painel das vendas de 2024")
    _make_report(client, headers, workspace, connection, "Relatorio de vendas")
    _make_report(client, headers, workspace, connection, "Vendas por regiao")
    _make_report(client, headers, workspace, connection, "Vendas")

    names = [entry["name"] for entry in _search(client, headers, "vendas")]

    # Exato, depois "comeca com", depois "palavra comeca com" (o nome mais curto primeiro)
    assert names == ["Vendas", "Vendas por regiao", "Relatorio de vendas", "Painel das vendas de 2024"]


def test_colecoes_aparecem_nos_resultados(client):
    headers = _register_and_login(client, "admin@example.com")
    connection = _make_connection(client, headers)
    comercial = _make_workspace(client, headers, "Comercial")
    _make_report(client, headers, comercial, connection, "Metas do comercial")

    results = _search(client, headers, "comercial")

    kinds = [(entry["kind"], entry["name"]) for entry in results]
    # Colecao "Comercial" (exata) vem antes do relatorio que so contem a palavra
    assert kinds == [("colecao", "Comercial"), ("relatorio", "Metas do comercial")]
    colecao = results[0]
    assert colecao["id"] == colecao["workspace_id"] == comercial["id"]
    assert colecao["display_type"] is None
    assert results[1]["display_type"] == "relatorio"


def test_na_mesma_faixa_a_colecao_vem_antes_do_relatorio(client):
    headers = _register_and_login(client, "admin@example.com")
    connection = _make_connection(client, headers)
    vendas = _make_workspace(client, headers, "Vendas")
    # Relatorio criado primeiro e com nome igual ao da colecao: mesma faixa (nome exato)
    _make_report(client, headers, vendas, connection, "Vendas")

    kinds = [entry["kind"] for entry in _search(client, headers, "vendas")]

    assert kinds == ["colecao", "relatorio"]


def test_busca_ignora_acento_e_maiuscula(client):
    headers = _register_and_login(client, "admin@example.com")
    connection = _make_connection(client, headers)
    workspace = _make_workspace(client, headers, "Gestão")
    _make_report(client, headers, workspace, connection, "Relatório de Sinistralidade")

    assert [e["name"] for e in _search(client, headers, "gestao")] == ["Gestão"]
    assert [e["name"] for e in _search(client, headers, "RELATORIO")] == ["Relatório de Sinistralidade"]
    assert [e["name"] for e in _search(client, headers, "relatório")] == ["Relatório de Sinistralidade"]


def test_varias_palavras_em_qualquer_ordem(client):
    headers = _register_and_login(client, "admin@example.com")
    connection = _make_connection(client, headers)
    workspace = _make_workspace(client, headers, "Comercial")
    _make_report(client, headers, workspace, connection, "Vendas 2024 Norte")
    _make_report(client, headers, workspace, connection, "Vendas 2024 Sul")

    assert [e["name"] for e in _search(client, headers, "norte vendas")] == ["Vendas 2024 Norte"]


def test_texto_vazio_ou_sem_resultado_devolve_lista_vazia(client):
    headers = _register_and_login(client, "admin@example.com")
    connection = _make_connection(client, headers)
    workspace = _make_workspace(client, headers, "Comercial")
    _make_report(client, headers, workspace, connection, "Vendas")

    assert _search(client, headers, "   ") == []
    assert _search(client, headers, "inexistente") == []


def test_caracteres_especiais_nao_quebram_a_busca(client):
    headers = _register_and_login(client, "admin@example.com")
    connection = _make_connection(client, headers)
    workspace = _make_workspace(client, headers, "Comercial")
    _make_report(client, headers, workspace, connection, "Vendas")

    for text in ["%", "_", ".*", "(", "'; drop table reports; --", "\\"]:
        assert _search(client, headers, text) == []


def test_limite_de_dez_resultados(client):
    headers = _register_and_login(client, "admin@example.com")
    connection = _make_connection(client, headers)
    workspace = _make_workspace(client, headers, "Comercial")
    for index in range(15):
        _make_report(client, headers, workspace, connection, f"Vendas {index:02d}")

    assert len(_search(client, headers, "vendas")) == 10


def test_usuario_sem_acesso_nao_ve_colecao_nem_relatorio(client):
    admin = _register_and_login(client, "admin@example.com")
    connection = _make_connection(client, admin)
    secreta = _make_workspace(client, admin, "Diretoria Secreta")
    _make_report(client, admin, secreta, connection, "Folha da diretoria")

    # Toda colecao nova da acesso de leitor ao grupo padrao; tira, pra ficar so com o admin
    groups = client.get("/groups/", headers=admin).json()
    default_group = next(g for g in groups if g["is_default"])
    client.delete(f"/workspaces/{secreta['id']}/access/{default_group['id']}", headers=admin)

    outro = _register_and_login(client, "outro@example.com")

    assert _search(client, outro, "diretoria") == []
    # O admin continua vendo os dois
    assert {entry["kind"] for entry in _search(client, admin, "diretoria")} == {"colecao", "relatorio"}


def test_colecao_com_acesso_padrao_aparece_para_qualquer_usuario(client):
    """Contraponto do teste acima: sem revogar o acesso do grupo padrao, um usuario comum
    enxerga a colecao e os relatorios dela, igual ao resto do app."""
    admin = _register_and_login(client, "admin@example.com")
    connection = _make_connection(client, admin)
    aberta = _make_workspace(client, admin, "Comercial Aberta")
    _make_report(client, admin, aberta, connection, "Metas do trimestre")

    outro = _register_and_login(client, "outro@example.com")

    assert {entry["kind"] for entry in _search(client, outro, "aberta")} == {"colecao"}
    assert {entry["kind"] for entry in _search(client, outro, "metas")} == {"relatorio"}


def test_sem_login_e_negado(client):
    assert client.get("/search/", params={"q": "vendas"}).status_code == 401

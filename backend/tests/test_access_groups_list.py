"""Lista das permissões de todos os grupos de uma vez (visão por grupo da aba Membros e permissões)."""

import pytest

PASSWORD = "SenhaForte123"


def _headers(client, email: str) -> dict:
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(client):
    return _headers(client, "admin@example.com")


def test_exige_login_e_administrador(client, admin):
    pessoa = _headers(client, "pessoa@example.com")
    assert client.get("/access/groups").status_code == 401
    assert client.get("/access/groups", headers=pessoa).status_code == 403


def test_traz_todos_os_grupos_com_as_permissoes_de_cada_um(client, admin):
    colecao = client.post("/workspaces/", json={"name": "Vendas"}, headers=admin).json()["id"]
    comercial = client.post("/groups/", json={"name": "Comercial"}, headers=admin).json()["id"]
    vazio = client.post("/groups/", json={"name": "Vazio"}, headers=admin).json()["id"]
    client.put(
        f"/access/groups/{comercial}",
        json={"blocks": [{"workspace_id": colecao, "permissions": ["relatorio.editar"]}, {"workspace_id": None, "permissions": ["ia.usar"]}]},
        headers=admin,
    )

    corpo = client.get("/access/groups", headers=admin).json()["groups"]

    por_id = {g["group_id"]: g for g in corpo}
    nomes = {g["id"]: g for g in client.get("/groups/", headers=admin).json()}
    assert set(por_id) == set(nomes)  # padrão, administradores, Comercial e Vazio
    assert por_id[vazio]["blocks"] == []
    blocos = {b["workspace_id"]: b["permissions"] for b in por_id[comercial]["blocks"]}
    assert blocos[None] == ["ia.usar"]
    assert blocos[colecao] == ["colecao.ver", "relatorio.editar"]
    assert por_id[comercial]["editable"] is True


def test_administradores_vem_como_nao_editavel_e_primeiro(client, admin):
    corpo = client.get("/access/groups", headers=admin).json()["groups"]
    nomes = {g["id"]: g for g in client.get("/groups/", headers=admin).json()}
    assert nomes[corpo[0]["group_id"]]["is_admin_group"] is True
    assert corpo[0]["editable"] is False

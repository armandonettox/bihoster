"""default_workspace_id das Configuracoes precisa apontar pra uma colecao que existe. Antes o PUT
gravava qualquer numero e o redirecionamento da home ia parar numa colecao inexistente."""


def _register_and_login(client, email: str = "admin@example.com") -> str:
    client.post("/auth/register", json={"name": "Admin", "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    return resp.json()["access_token"]


def _headers(client) -> dict:
    return {"Authorization": f"Bearer {_register_and_login(client)}"}


def test_default_workspace_inexistente_da_400_e_nao_grava(client):
    headers = _headers(client)

    resp = client.put("/settings/", json={"default_workspace_id": 9999}, headers=headers)

    assert resp.status_code == 400
    assert client.get("/settings/").json()["default_workspace_id"] is None


def test_default_workspace_existente_e_aceito(client):
    headers = _headers(client)
    workspace = client.post("/workspaces/", json={"name": "Comercial"}, headers=headers).json()

    resp = client.put("/settings/", json={"default_workspace_id": workspace["id"]}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["default_workspace_id"] == workspace["id"]


def test_default_workspace_pode_ser_limpo_com_nulo(client):
    headers = _headers(client)
    workspace = client.post("/workspaces/", json={"name": "Comercial"}, headers=headers).json()
    client.put("/settings/", json={"default_workspace_id": workspace["id"]}, headers=headers)

    resp = client.put("/settings/", json={"default_workspace_id": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["default_workspace_id"] is None

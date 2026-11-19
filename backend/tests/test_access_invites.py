"""Adicionar membro já com permissões: quem tem conta recebe na hora, quem não tem fica reservado no convite."""

import pytest

from app.models.access_grant import AccessGrant, AccessInviteGrant

PASSWORD = "SenhaForte123"


def _headers(client, email: str) -> dict:
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(client):
    return _headers(client, "admin@example.com")


@pytest.fixture
def pessoa(client, admin):
    return _headers(client, "pessoa@example.com")


@pytest.fixture
def colecao(client, admin):
    return client.post("/workspaces/", json={"name": "Vendas"}, headers=admin).json()["id"]


def _grupo(client, admin, nome="Comercial") -> int:
    return client.post("/groups/", json={"name": nome}, headers=admin).json()["id"]


def _convidar(client, admin, email, grupo) -> str:
    resp = client.post(f"/groups/{grupo}/invite", json={"email": email}, headers=admin)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["status"]


def _corpo(email, colecao):
    return {
        "email": email,
        "blocks": [
            {"workspace_id": colecao, "permissions": ["relatorio.publicar"]},
            {"workspace_id": None, "permissions": ["ia.usar"]},
        ],
    }


def test_quem_ja_tem_conta_recebe_na_hora_e_soma_com_o_que_tinha(client, admin, pessoa, colecao):
    usuarios = client.get("/users/", headers=admin).json()
    pessoa_id = next(u["id"] for u in usuarios if u["email"] == "pessoa@example.com")
    client.put(
        f"/access/users/{pessoa_id}",
        json={"blocks": [{"workspace_id": colecao, "permissions": ["relatorio.excluir"]}]},
        headers=admin,
    )

    resp = client.post("/access/by-email", json=_corpo("pessoa@example.com", colecao), headers=admin)

    assert resp.status_code == 200 and resp.json() == {"status": "applied"}
    meu = client.get("/access/me", headers=pessoa).json()
    assert meu["global_permissions"] == ["ia.usar"]
    assert set(meu["workspace_permissions"][str(colecao)]) == {"colecao.ver", "relatorio.excluir", "relatorio.publicar"}


def test_repetir_nao_duplica(client, admin, pessoa, colecao, db_session):
    for _ in range(2):
        client.post("/access/by-email", json=_corpo("pessoa@example.com", colecao), headers=admin)
    # ver a coleção, publicar e ia.usar
    assert db_session.query(AccessGrant).filter(AccessGrant.user_id.isnot(None)).count() == 3


def test_sem_convite_nao_reserva_nada(client, admin, colecao):
    resp = client.post("/access/by-email", json=_corpo("ninguem@example.com", colecao), headers=admin)
    assert resp.status_code == 400


def test_convidado_recebe_as_permissoes_ao_se_cadastrar(client, admin, colecao):
    grupo = _grupo(client, admin)
    assert _convidar(client, admin, "novo@example.com", grupo) == "invited"
    resp = client.post("/access/by-email", json=_corpo("novo@example.com", colecao), headers=admin)
    assert resp.json() == {"status": "pending"}

    novo = _headers(client, "novo@example.com")  # o cadastro consome o convite

    meu = client.get("/access/me", headers=novo).json()
    assert meu["global_permissions"] == ["ia.usar"]
    assert meu["workspace_permissions"][str(colecao)] == ["colecao.ver", "relatorio.publicar"]


def test_convite_cancelado_leva_as_permissoes_junto(client, admin, colecao, db_session):
    grupo = _grupo(client, admin)
    _convidar(client, admin, "novo@example.com", grupo)
    client.post("/access/by-email", json=_corpo("novo@example.com", colecao), headers=admin)
    convite = client.get(f"/groups/{grupo}/invites", headers=admin).json()[0]["id"]

    assert client.delete(f"/groups/{grupo}/invites/{convite}", headers=admin).status_code == 204
    assert db_session.query(AccessInviteGrant).count() == 0

    novo = _headers(client, "novo@example.com")
    assert client.get("/access/me", headers=novo).json()["global_permissions"] == []


def test_excluir_o_grupo_do_convite_tambem_limpa(client, admin, colecao, db_session):
    grupo = _grupo(client, admin)
    _convidar(client, admin, "novo@example.com", grupo)
    client.post("/access/by-email", json=_corpo("novo@example.com", colecao), headers=admin)

    client.delete(f"/groups/{grupo}", headers=admin)

    assert db_session.query(AccessInviteGrant).count() == 0


def test_com_outro_convite_vivo_as_permissoes_ficam(client, admin, colecao, db_session):
    g1, g2 = _grupo(client, admin, "G1"), _grupo(client, admin, "G2")
    _convidar(client, admin, "novo@example.com", g1)
    _convidar(client, admin, "novo@example.com", g2)
    client.post("/access/by-email", json=_corpo("novo@example.com", colecao), headers=admin)
    convite = client.get(f"/groups/{g1}/invites", headers=admin).json()[0]["id"]

    client.delete(f"/groups/{g1}/invites/{convite}", headers=admin)

    # ver a coleção, publicar e ia.usar continuam reservados
    assert db_session.query(AccessInviteGrant).count() == 3


def test_colecao_excluida_limpa_a_reserva(client, admin, colecao, db_session):
    grupo = _grupo(client, admin)
    _convidar(client, admin, "novo@example.com", grupo)
    client.post("/access/by-email", json=_corpo("novo@example.com", colecao), headers=admin)

    client.delete(f"/workspaces/{colecao}", headers=admin)

    assert db_session.query(AccessInviteGrant).filter(AccessInviteGrant.workspace_id.isnot(None)).count() == 0


def test_so_admin_usa_e_administrador_e_recusado(client, admin, pessoa, colecao):
    assert client.post("/access/by-email", json=_corpo("pessoa@example.com", colecao), headers=pessoa).status_code == 403
    assert client.post("/access/by-email", json=_corpo("admin@example.com", colecao), headers=admin).status_code == 400

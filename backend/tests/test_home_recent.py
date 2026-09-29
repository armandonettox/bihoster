"""Colecoes recentes da Home: nao pode degradar com uso repetido da mesma colecao, e a gravacao
da visita nao pode inchar a auditoria a cada abertura."""

from datetime import datetime, timedelta, timezone

from app.models.audit_log import AuditLog


def _register_and_login(client, email: str = "admin@example.com") -> tuple[str, int]:
    client.post("/auth/register", json={"name": "Admin", "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    token = resp.json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    return token, me["id"]


def _utc_naive(minutes_ago: int) -> datetime:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).replace(tzinfo=None)


def _view_rows(db_session, user_id: int, workspace_id: int) -> int:
    return (
        db_session.query(AuditLog)
        .filter(AuditLog.user_id == user_id, AuditLog.action == "view_collection", AuditLog.workspace_id == workspace_id)
        .count()
    )


def test_recentes_nao_degrada_quando_uma_colecao_e_aberta_muitas_vezes(client, db_session):
    token, user_id = _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    ids = [client.post("/workspaces/", json={"name": f"Colecao {i}"}, headers=headers).json()["id"] for i in range(3)]
    a, b, c = ids

    # b e c vistas uma vez cada, antes; a vista 60 vezes depois (mais recente). O limite antigo
    # de 50 linhas so enxergava a colecao a.
    db_session.add(AuditLog(user_id=user_id, workspace_id=b, action="view_collection", entity="workspace", entity_id=str(b), created_at=_utc_naive(300)))
    db_session.add(AuditLog(user_id=user_id, workspace_id=c, action="view_collection", entity="workspace", entity_id=str(c), created_at=_utc_naive(200)))
    for i in range(60):
        db_session.add(AuditLog(user_id=user_id, workspace_id=a, action="view_collection", entity="workspace", entity_id=str(a), created_at=_utc_naive(100 - i // 2)))
    db_session.commit()

    resp = client.get("/home/recent", headers=headers)

    assert resp.status_code == 200
    assert [entry["id"] for entry in resp.json()] == [a, c, b]


def test_recentes_ordena_pela_visita_mais_recente_de_cada_colecao(client, db_session):
    token, user_id = _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    a = client.post("/workspaces/", json={"name": "A"}, headers=headers).json()["id"]
    b = client.post("/workspaces/", json={"name": "B"}, headers=headers).json()["id"]

    # a foi vista ha muito tempo e ha pouco; b so no meio. a deve vir primeiro.
    for ws, minutes in ((a, 500), (b, 100), (a, 5)):
        db_session.add(AuditLog(user_id=user_id, workspace_id=ws, action="view_collection", entity="workspace", entity_id=str(ws), created_at=_utc_naive(minutes)))
    db_session.commit()

    resp = client.get("/home/recent", headers=headers)

    assert [entry["id"] for entry in resp.json()] == [a, b]


def test_abrir_a_mesma_colecao_de_novo_em_seguida_nao_grava_outra_linha(client, db_session):
    token, user_id = _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    ws = client.post("/workspaces/", json={"name": "Comercial"}, headers=headers).json()["id"]

    for _ in range(3):
        assert client.post(f"/home/collections/{ws}/view", headers=headers).status_code == 204

    assert _view_rows(db_session, user_id, ws) == 1


def test_abrir_a_colecao_depois_da_janela_grava_nova_linha(client, db_session):
    token, user_id = _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}
    ws = client.post("/workspaces/", json={"name": "Comercial"}, headers=headers).json()["id"]
    db_session.add(AuditLog(user_id=user_id, workspace_id=ws, action="view_collection", entity="workspace", entity_id=str(ws), created_at=_utc_naive(11)))
    db_session.commit()

    assert client.post(f"/home/collections/{ws}/view", headers=headers).status_code == 204

    assert _view_rows(db_session, user_id, ws) == 2


def test_visita_a_colecao_inexistente_da_404_e_nao_grava(client, db_session):
    token, user_id = _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.post("/home/collections/9999/view", headers=headers)

    assert resp.status_code == 404
    assert _view_rows(db_session, user_id, 9999) == 0

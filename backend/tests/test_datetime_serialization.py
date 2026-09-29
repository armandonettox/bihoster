"""Datas devolvidas pela API precisam carregar fuso (UTC). O SQLite devolve datetime "ingenuo"
(sem tzinfo) e o Pydantic serializa sem "Z"; o navegador le "2026-09-29T13:00:00" como horario
LOCAL, deslocando auditoria e ultimo login pela diferenca de fuso (3h no Brasil)."""

import re

# Termina em "Z" ou em deslocamento explicito (+00:00 / -03:00)
_TZ_SUFFIX = re.compile(r"(Z|[+-]\d{2}:\d{2})$")


def _register_and_login(client, email: str = "admin@example.com") -> str:
    client.post("/auth/register", json={"name": "Admin", "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    return resp.json()["access_token"]


def test_audit_created_at_sai_com_fuso(client):
    headers = {"Authorization": f"Bearer {_register_and_login(client)}"}

    resp = client.get("/audit", headers=headers)

    assert resp.status_code == 200
    entries = resp.json()
    assert entries, "o login/registro deveria ter gerado ao menos uma linha de auditoria"
    for entry in entries:
        assert _TZ_SUFFIX.search(entry["created_at"]), f"data sem fuso: {entry['created_at']}"


def test_users_last_login_e_created_at_saem_com_fuso(client):
    headers = {"Authorization": f"Bearer {_register_and_login(client)}"}

    resp = client.get("/users/", headers=headers)

    assert resp.status_code == 200
    users = resp.json()
    assert users
    logged = [u for u in users if u["last_login"]]
    assert logged, "o usuario que acabou de logar deveria ter last_login"
    for user in logged:
        assert _TZ_SUFFIX.search(user["last_login"]), f"last_login sem fuso: {user['last_login']}"

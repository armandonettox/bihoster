"""A auditoria guarda o email de quem agiu. Ao apagar um usuario o user_id vira nulo, e sem o
email a interface mostrava "Sistema" para acoes que foram de uma pessoa."""


def _register_and_login(client, email: str, name: str = "Pessoa") -> tuple[str, dict]:
    client.post("/auth/register", json={"name": name, "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    token = resp.json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    return token, me


def _audit(client, headers) -> list[dict]:
    resp = client.get("/audit", headers=headers)
    assert resp.status_code == 200
    return resp.json()


def test_acao_nova_grava_o_email_de_quem_agiu(client):
    token, me = _register_and_login(client, "admin@example.com", "Admin")
    headers = {"Authorization": f"Bearer {token}"}

    entries = [e for e in _audit(client, headers) if e["user_id"] == me["id"]]

    assert entries, "o login do admin deveria ter gerado auditoria"
    assert all(e["user_email"] == "admin@example.com" for e in entries)


def test_apagar_usuario_preserva_o_email_nas_acoes_dele(client):
    admin_token, _ = _register_and_login(client, "admin@example.com", "Admin")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    _, other = _register_and_login(client, "saiu@example.com", "Saiu")

    resp = client.delete(f"/users/{other['id']}", headers=admin_headers)
    assert resp.status_code == 204

    orphaned = [e for e in _audit(client, admin_headers) if e["user_email"] == "saiu@example.com"]
    assert orphaned, "as acoes do usuario apagado deveriam continuar identificadas pelo email"
    assert all(e["user_id"] is None and e["user_name"] is None for e in orphaned)


def test_acoes_antigas_sem_email_tambem_sao_preservadas_ao_apagar(client, db_session):
    """Linhas gravadas antes desta mudanca nao tem user_email; ao apagar o usuario o email e
    copiado para elas antes de perder o vinculo."""
    from app.models.audit_log import AuditLog

    admin_token, _ = _register_and_login(client, "admin@example.com", "Admin")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    _, other = _register_and_login(client, "antigo@example.com", "Antigo")
    db_session.query(AuditLog).filter(AuditLog.user_id == other["id"]).update({"user_email": None})
    db_session.commit()

    client.delete(f"/users/{other['id']}", headers=admin_headers)

    kept = [e for e in _audit(client, admin_headers) if e["user_email"] == "antigo@example.com"]
    assert kept

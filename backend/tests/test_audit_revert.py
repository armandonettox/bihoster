"""Reverter acoes pela auditoria: gravar o antes, voltar ao antes, avisar quando mudou de novo."""

from app.models.audit_log import AuditLog

PASSWORD = "SenhaForte123"


def _login(client, email: str, name: str = "Pessoa") -> dict:
    client.post("/auth/register", json={"name": name, "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _admin(client):
    return _login(client, "admin@example.com", "Admin")


def _entries(client, admin, **params) -> list[dict]:
    return client.get("/audit/search", params={"page_size": 100, **params}, headers=admin).json()["items"]


def _last(client, admin, action: str) -> dict:
    return next(e for e in _entries(client, admin, action=[action]))


def _revert(client, admin, entry, force: bool = False):
    return client.post(f"/audit/{entry['id']}/revert", json={"force": force}, headers=admin)


def _workspace(client, admin, name="Comercial") -> dict:
    return client.post("/workspaces/", json={"name": name}, headers=admin).json()


def _group(client, admin, name="Time") -> dict:
    return client.post("/groups/", json={"name": name}, headers=admin).json()


# --- colecao ---


def test_editar_colecao_grava_o_antes_e_a_reversao_volta_ao_estado_anterior(client):
    admin = _admin(client)
    ws = _workspace(client, admin)

    client.put(f"/workspaces/{ws['id']}", json={"name": "Financeiro", "color": "#ff0000"}, headers=admin)
    entry = _last(client, admin, "update")

    assert entry["revertible"] is True
    assert entry["revert_summary"].startswith("Desfazer a edicao da colecao: ")
    assert 'nome volta de "Financeiro" para "Comercial"' in entry["revert_summary"]
    resp = _revert(client, admin, entry)

    assert resp.status_code == 200
    back = client.get(f"/workspaces/{ws['id']}", headers=admin).json()
    assert back["name"] == "Comercial"
    assert back["color"] == ws["color"]


def test_a_reversao_fica_registrada_e_marca_o_original(client):
    admin = _admin(client)
    ws = _workspace(client, admin)
    client.put(f"/workspaces/{ws['id']}", json={"name": "Novo nome"}, headers=admin)
    entry = _last(client, admin, "update")

    _revert(client, admin, entry)

    original = next(e for e in _entries(client, admin) if e["id"] == entry["id"])
    assert original["revertible"] is False
    assert original["reverted_at"] is not None
    assert original["reverted_by_name"] == "Admin"
    assert original["revert_summary"] is None
    registro = _last(client, admin, "revert")
    assert registro["action_label"] == "Acao revertida"
    assert f"#{entry['id']}" in registro["details"]
    assert registro["revertible"] is False  # reverter a reversao nao e uma opcao


def test_nao_reverte_duas_vezes(client):
    admin = _admin(client)
    ws = _workspace(client, admin)
    client.put(f"/workspaces/{ws['id']}", json={"name": "Outro"}, headers=admin)
    entry = _last(client, admin, "update")

    assert _revert(client, admin, entry).status_code == 200
    again = _revert(client, admin, entry)

    assert again.status_code == 400
    assert "ja foi revertida" in again.json()["detail"]


def test_mudanca_depois_da_acao_gera_conflito_e_so_segue_com_confirmacao(client):
    admin = _admin(client)
    ws = _workspace(client, admin)
    client.put(f"/workspaces/{ws['id']}", json={"name": "B"}, headers=admin)
    first = next(e for e in _entries(client, admin, action=["update"]))
    client.put(f"/workspaces/{ws['id']}", json={"name": "C"}, headers=admin)

    resp = _revert(client, admin, first)

    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["code"] == "conflict"
    assert 'nome: B' in detail["expected"] and 'nome: C' in detail["current"] and "nome: Comercial" in detail["after_revert"]
    assert client.get(f"/workspaces/{ws['id']}", headers=admin).json()["name"] == "C"  # nada mudou

    forced = _revert(client, admin, first, force=True)
    assert forced.status_code == 200
    assert client.get(f"/workspaces/{ws['id']}", headers=admin).json()["name"] == "Comercial"


def test_colecao_apagada_depois_nao_tem_o_que_reverter(client):
    admin = _admin(client)
    ws = _workspace(client, admin)
    client.put(f"/workspaces/{ws['id']}", json={"name": "Outro"}, headers=admin)
    entry = _last(client, admin, "update")
    client.delete(f"/workspaces/{ws['id']}", headers=admin)

    resp = _revert(client, admin, entry, force=True)

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "gone"


def test_salvar_sem_mudar_nada_nao_cria_reversao(client):
    admin = _admin(client)
    ws = _workspace(client, admin)

    client.put(f"/workspaces/{ws['id']}", json={"name": ws["name"]}, headers=admin)

    assert _last(client, admin, "update")["revertible"] is False


# --- relatorio ---


def _report(client, admin, workspace) -> dict:
    conn = client.post(
        "/powerbi-connections/",
        json={"name": "Conta", "tenant_id": "t1", "client_id": "c1", "client_secret": "s1"},
        headers=admin,
    ).json()
    body = {
        "name": "Vendas",
        "powerbi_connection_id": conn["id"],
        "pbi_workspace_id": "pbi-ws",
        "pbi_report_id": "pbi-rel",
        "pbi_page_names": ["A", "B"],
    }
    return client.post(f"/workspaces/{workspace['id']}/reports/", json=body, headers=admin).json()


def test_editar_relatorio_reverte_nome_painel_e_abas(client):
    admin = _admin(client)
    ws = _workspace(client, admin)
    report = _report(client, admin, ws)
    url = f"/workspaces/{ws['id']}/reports/{report['id']}"

    client.put(url, json={"name": "Vendas 2", "show_filter_pane": True, "pbi_page_names": ["C"]}, headers=admin)
    entry = next(e for e in _entries(client, admin, action=["update"], entity=["report"]))
    assert entry["revertible"] is True

    assert _revert(client, admin, entry).status_code == 200

    back = client.get(f"/workspaces/{ws['id']}/reports/", headers=admin).json()[0]
    assert back["name"] == "Vendas"
    assert back["show_filter_pane"] is False
    assert back["pbi_page_names"] == ["A", "B"]


# --- acesso de grupo ---


def test_mudar_acesso_do_grupo_e_reverter(client):
    admin = _admin(client)
    ws = _workspace(client, admin)
    group = _group(client, admin)
    client.put(f"/workspaces/{ws['id']}/access/{group['id']}", json={"role": "viewer"}, headers=admin)
    client.put(f"/workspaces/{ws['id']}/access/{group['id']}", json={"role": "editor"}, headers=admin)
    editor_change = next(e for e in _entries(client, admin, action=["set_access"]))
    assert "de editor para leitor" in editor_change["revert_summary"]

    assert _revert(client, admin, editor_change).status_code == 200

    roles = {a["group_id"]: a["role"] for a in client.get(f"/workspaces/{ws['id']}/access", headers=admin).json()}
    assert roles[group["id"]] == "viewer"


def test_primeiro_acesso_do_grupo_reverte_para_sem_acesso(client):
    admin = _admin(client)
    ws = _workspace(client, admin)
    group = _group(client, admin)
    client.put(f"/workspaces/{ws['id']}/access/{group['id']}", json={"role": "editor"}, headers=admin)
    entry = _last(client, admin, "set_access")
    assert "de editor para sem acesso" in entry["revert_summary"]

    _revert(client, admin, entry)

    roles = {a["group_id"]: a["role"] for a in client.get(f"/workspaces/{ws['id']}/access", headers=admin).json()}
    assert roles[group["id"]] is None


def test_remover_acesso_passa_a_ser_auditado_e_pode_ser_revertido(client):
    admin = _admin(client)
    ws = _workspace(client, admin)
    group = _group(client, admin)
    client.put(f"/workspaces/{ws['id']}/access/{group['id']}", json={"role": "editor"}, headers=admin)
    client.delete(f"/workspaces/{ws['id']}/access/{group['id']}", headers=admin)
    removal = _last(client, admin, "remove_access")
    assert removal["action_label"] == "Acesso de grupo removido"

    assert _revert(client, admin, removal).status_code == 200

    roles = {a["group_id"]: a["role"] for a in client.get(f"/workspaces/{ws['id']}/access", headers=admin).json()}
    assert roles[group["id"]] == "editor"


def test_acesso_igual_ao_que_ja_estava_nao_cria_reversao(client):
    admin = _admin(client)
    ws = _workspace(client, admin)
    group = _group(client, admin)
    client.put(f"/workspaces/{ws['id']}/access/{group['id']}", json={"role": "editor"}, headers=admin)

    client.put(f"/workspaces/{ws['id']}/access/{group['id']}", json={"role": "editor"}, headers=admin)

    latest = next(e for e in _entries(client, admin, action=["set_access"]))
    assert latest["revertible"] is False


# --- permissoes de grupo ---


def test_mudar_permissoes_do_grupo_e_reverter(client):
    admin = _admin(client)
    group = _group(client, admin)
    client.put(f"/groups/{group['id']}/permissions", json={"permissions": ["ia.usar"]}, headers=admin)
    client.put(f"/groups/{group['id']}/permissions", json={"permissions": ["ia.usar", "ia.gerenciar"]}, headers=admin)
    entry = next(e for e in _entries(client, admin, action=["set_group_permissions"]))

    assert _revert(client, admin, entry).status_code == 200

    assert client.get(f"/groups/{group['id']}/permissions", headers=admin).json()["permissions"] == ["ia.usar"]


# --- membros ---


def test_adicionar_membro_ao_grupo_e_reverter_tira_a_pessoa(client):
    admin = _admin(client)
    _login(client, "ana@example.com", "Ana")
    group = _group(client, admin)
    client.post(f"/groups/{group['id']}/members", json={"email": "ana@example.com"}, headers=admin)
    entry = _last(client, admin, "add_group_member")
    assert entry["revert_summary"] == 'Tirar ana@example.com do grupo "Time"'

    assert _revert(client, admin, entry).status_code == 200

    members = client.get(f"/groups/{group['id']}/members", headers=admin).json()
    assert members == []


def test_convite_de_quem_ja_tem_conta_tambem_pode_ser_revertido(client):
    admin = _admin(client)
    _login(client, "ana@example.com", "Ana")
    group = _group(client, admin)
    client.post(f"/groups/{group['id']}/invite", json={"email": "ana@example.com"}, headers=admin)
    entry = _last(client, admin, "add_group_member")

    assert _revert(client, admin, entry).status_code == 200
    assert client.get(f"/groups/{group['id']}/members", headers=admin).json() == []


def test_reverter_nao_deixa_a_plataforma_sem_administrador(client):
    admin = _admin(client)
    _login(client, "outro@example.com", "Outro")
    groups = client.get("/groups/", headers=admin).json()
    admins = next(g for g in groups if g["is_admin_group"])
    client.post(f"/groups/{admins['id']}/members", json={"email": "outro@example.com"}, headers=admin)
    entry = _last(client, admin, "add_group_member")
    me = client.get("/auth/me", headers=admin).json()
    # O primeiro administrador sai; sobra so o "outro", e reverter a adicao dele o deixaria sem ninguem
    client.delete(f"/groups/{admins['id']}/members/{me['id']}", headers=admin)
    outro_headers = _login(client, "outro@example.com")

    resp = _revert(client, outro_headers, entry, force=True)

    assert resp.status_code == 400
    assert "ultimo administrador" in resp.json()["detail"]
    assert len(client.get(f"/groups/{admins['id']}/members", headers=outro_headers).json()) == 1


# --- regras gerais ---


def test_so_administrador_reverte_e_acao_sem_antes_nao_e_reversivel(client, db_session):
    admin = _admin(client)
    comum = _login(client, "comum@example.com", "Comum")
    ws = _workspace(client, admin)
    client.put(f"/workspaces/{ws['id']}", json={"name": "X"}, headers=admin)
    entry = _last(client, admin, "update")

    assert client.post(f"/audit/{entry['id']}/revert", json={}, headers=comum).status_code == 403
    assert client.post(f"/audit/{entry['id']}/revert", json={}).status_code == 401
    assert client.post("/audit/999999/revert", json={}, headers=admin).status_code == 404

    login = _last(client, admin, "login")
    assert login["revertible"] is False and login["revert_summary"] is None
    resp = client.post(f"/audit/{login['id']}/revert", json={}, headers=admin)
    assert resp.status_code == 400
    assert "nao pode ser revertida" in resp.json()["detail"]


def test_historico_sem_o_antes_continua_listando_normalmente(client, db_session):
    """Linhas de antes deste recurso nao tem `change`: aparecem, so que nao reversiveis."""
    admin = _admin(client)
    db_session.add(AuditLog(user_id=None, action="update", entity="workspace", details="antigo"))
    db_session.commit()

    antigo = next(e for e in _entries(client, admin) if e["details"] == "antigo")

    assert antigo["revertible"] is False
    assert antigo["reverted_at"] is None

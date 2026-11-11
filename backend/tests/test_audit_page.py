"""Pagina de Auditoria: busca e filtros no servidor, opcoes dos filtros e resumo dos analiticos."""

from datetime import datetime, timezone

from app.models.audit_log import AuditLog
from app.models.workspace import Workspace

PASSWORD = "SenhaForte123"


def _login(client, email: str, name: str) -> tuple[dict, dict]:
    client.post("/auth/register", json={"name": name, "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return headers, client.get("/auth/me", headers=headers).json()


def _log(db, *, user, action, entity="user", workspace_id=None, details=None, entity_id=None, when="2026-11-10 15:00:00"):
    db.add(
        AuditLog(
            user_id=user["id"] if user else None,
            user_email=user["email"] if user else None,
            workspace_id=workspace_id,
            action=action,
            entity=entity,
            entity_id=entity_id,
            details=details,
            created_at=datetime.strptime(when, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc),
        )
    )
    db.commit()


def _clean(db):
    """Parte de um banco so com o que o teste cria (o login do admin tambem gera auditoria)."""
    db.query(AuditLog).delete()
    db.commit()


def _seed(client, db_session):
    admin_h, admin = _login(client, "admin@example.com", "Admin Geral")
    _, ana = _login(client, "ana@example.com", "Ana Lima")
    workspace = Workspace(name="Financeiro", slug="financeiro")
    db_session.add(workspace)
    db_session.commit()
    _clean(db_session)
    _log(db_session, user=admin, action="login", when="2026-11-10 15:00:00")
    _log(db_session, user=admin, action="login", details="google", when="2026-11-10 16:00:00")
    _log(db_session, user=ana, action="login_blocked", when="2026-11-09 12:00:00")
    _log(db_session, user=ana, action="view_collection", entity="workspace", workspace_id=workspace.id, when="2026-11-09 13:00:00")
    _log(db_session, user=ana, action="view_collection", entity="workspace", workspace_id=workspace.id, when="2026-11-08 13:00:00")
    _log(db_session, user=None, action="apply_update", entity="system", details="v1.9.0", when="2026-11-01 10:00:00")
    return admin_h, admin, ana, workspace


def test_so_administrador_da_plataforma_acessa(client, db_session):
    _login(client, "admin@example.com", "Admin")
    ana_h, _ = _login(client, "ana@example.com", "Ana")

    for path in ("/audit/search", "/audit/summary", "/audit/options"):
        assert client.get(path, headers=ana_h).status_code == 403
        assert client.get(path).status_code == 401


def test_busca_pagina_e_ordena_do_mais_novo_para_o_mais_antigo(client, db_session):
    admin_h, *_ = _seed(client, db_session)

    page1 = client.get("/audit/search", params={"page_size": 4}, headers=admin_h).json()
    page2 = client.get("/audit/search", params={"page_size": 4, "page": 2}, headers=admin_h).json()

    assert page1["total"] == 6 and len(page1["items"]) == 4 and len(page2["items"]) == 2
    dates = [e["created_at"] for e in page1["items"] + page2["items"]]
    assert dates == sorted(dates, reverse=True)
    assert page1["items"][0]["action_label"] == "Login"


def test_busca_acha_pelo_nome_da_acao_em_portugues_e_por_pessoa(client, db_session):
    admin_h, *_ = _seed(client, db_session)

    by_label = client.get("/audit/search", params={"q": "bloqueado"}, headers=admin_h).json()
    by_person = client.get("/audit/search", params={"q": "ana lima"}, headers=admin_h).json()
    by_collection = client.get("/audit/search", params={"q": "financeiro"}, headers=admin_h).json()
    by_details = client.get("/audit/search", params={"q": "v1.9.0"}, headers=admin_h).json()

    assert {e["action"] for e in by_label["items"]} == {"login_blocked"}
    assert by_person["total"] == 3
    assert by_collection["total"] == 2
    assert by_details["total"] == 1
    assert client.get("/audit/search", params={"q": "100%"}, headers=admin_h).json()["total"] == 0


def test_filtros_de_pessoa_acao_colecao_e_periodo(client, db_session):
    admin_h, admin, ana, workspace = _seed(client, db_session)
    get = lambda **p: client.get("/audit/search", params=p, headers=admin_h).json()["total"]  # noqa: E731

    assert get(user_id=ana["id"]) == 3
    assert get(action="login") == 2
    assert get(workspace_id=workspace.id) == 2
    assert get(date_from="2026-11-09", date_to="2026-11-09") == 2
    assert get(date_from="2026-11-10") == 2
    assert get(date_to="2026-11-01") == 1
    assert get(user_id=ana["id"], action="view_collection", date_from="2026-11-09") == 1


def test_filtros_aceitam_varios_valores(client, db_session):
    admin_h, admin, ana, workspace = _seed(client, db_session)

    def total(path="/audit/search", **params):
        resp = client.get(path, params=params, headers=admin_h)
        return resp.json()["total"] if path.endswith("search") else resp.json()["totals"]["events"]

    # Duas pessoas = todos os eventos que tem pessoa (5 de 6; um e do sistema)
    assert total(user_id=[admin["id"], ana["id"]]) == 5
    assert total(action=["login", "login_blocked"]) == 3
    assert total(action=["login", "view_collection"], user_id=[ana["id"]]) == 2
    assert total(workspace_id=[workspace.id, 9999]) == 2
    # O resumo usa os mesmos filtros multiplos
    assert total("/audit/summary", user_id=[admin["id"], ana["id"]], action=["login", "login_blocked"]) == 3


def test_filtro_por_relatorio_e_opcoes_de_relatorio(client, db_session):
    from app.models.report import Report

    admin_h, admin, ana, workspace = _seed(client, db_session)
    vendas = Report(collection_id=workspace.id, name="Vendas", pbi_workspace_id="w", pbi_report_id="r1")
    custos = Report(collection_id=workspace.id, name="Custos", pbi_workspace_id="w", pbi_report_id="r2")
    db_session.add_all([vendas, custos])
    db_session.commit()
    for _ in range(2):
        _log(db_session, user=ana, action="view_report", entity="report", entity_id=str(vendas.id), workspace_id=workspace.id)
    _log(db_session, user=admin, action="update", entity="report", entity_id=str(custos.id), workspace_id=workspace.id)
    # Colecao com o mesmo numero do relatorio: nao pode entrar no filtro de relatorio
    _log(db_session, user=ana, action="view_collection", entity="workspace", entity_id=str(vendas.id), workspace_id=workspace.id)

    def total(path="/audit/search", **params):
        body = client.get(path, params=params, headers=admin_h).json()
        return body["total"] if path.endswith("search") else body["totals"]["events"]

    assert total(report_id=[vendas.id]) == 2
    assert total(report_id=[vendas.id, custos.id]) == 3
    assert total(report_id=[vendas.id], user_id=[admin["id"]]) == 0
    assert total("/audit/summary", report_id=[custos.id]) == 1

    options = client.get("/audit/options", headers=admin_h).json()
    assert options["reports"] == [
        {"id": custos.id, "name": "Custos", "collection": "Financeiro"},
        {"id": vendas.id, "name": "Vendas", "collection": "Financeiro"},
    ]


def test_filtro_por_recurso_e_nome_do_recurso_em_portugues(client, db_session):
    admin_h, *_ = _seed(client, db_session)

    def search(**params):
        return client.get("/audit/search", params=params, headers=admin_h).json()

    # Na massa de teste: 3 do tipo usuario, 2 de colecao e 1 do sistema
    assert search(entity=["workspace"])["total"] == 2
    assert search(entity=["system", "workspace"])["total"] == 3
    assert search(entity=["workspace"], action=["login"])["total"] == 0
    assert client.get("/audit/summary", params={"entity": ["system"]}, headers=admin_h).json()["totals"]["events"] == 1

    labels = {item["entity"]: item["entity_label"] for item in search(page_size=100)["items"]}
    assert labels == {"user": "Usuario", "workspace": "Colecao", "system": "Sistema"}

    options = client.get("/audit/options", headers=admin_h).json()
    assert {e["entity"]: e["label"] for e in options["entities"]} == labels


def test_periodo_vale_no_fuso_do_sistema(client, db_session):
    """02:00 UTC de 11/11 ainda e 10/11 em Sao Paulo (UTC-3)."""
    admin_h, admin, *_ = _seed(client, db_session)
    _log(db_session, user=admin, action="update", entity="report", when="2026-11-11 02:00:00")

    on_10 = client.get("/audit/search", params={"date_from": "2026-11-10", "date_to": "2026-11-10", "action": "update"}, headers=admin_h)
    on_11 = client.get("/audit/search", params={"date_from": "2026-11-11", "date_to": "2026-11-11", "action": "update"}, headers=admin_h)

    assert on_10.json()["total"] == 1
    assert on_11.json()["total"] == 0


def test_opcoes_dos_filtros_trazem_so_o_que_existe(client, db_session):
    admin_h, *_ = _seed(client, db_session)

    options = client.get("/audit/options", headers=admin_h).json()

    labels = {a["action"]: a["label"] for a in options["actions"]}
    assert labels["login_blocked"] == "Login bloqueado"
    assert "create" not in labels
    assert {u["name"] for u in options["users"]} == {"Admin Geral", "Ana Lima"}
    assert [c["name"] for c in options["collections"]] == ["Financeiro"]


def test_opcoes_de_pessoa_trazem_os_detalhes_do_cartao(client, db_session):
    admin_h, admin, ana, _ = _seed(client, db_session)

    people = {u["email"]: u for u in client.get("/audit/options", headers=admin_h).json()["users"]}

    boss = people["admin@example.com"]
    assert boss["is_platform_admin"] is True
    assert boss["groups"] == ["Todos os usuarios", "Administradores"]
    assert boss["last_login_at"] == "2026-11-10T16:00:00Z"  # o login mais recente dele
    assert boss["created_at"] is not None
    assert boss["login_provider"] == "password"

    colleague = people["ana@example.com"]
    assert colleague["is_platform_admin"] is False
    assert colleague["groups"] == ["Todos os usuarios"]
    assert colleague["last_login_at"] is None  # so teve login bloqueado, nunca logou na massa de teste


def test_resumo_dos_analiticos(client, db_session):
    admin_h, *_ = _seed(client, db_session)

    summary = client.get("/audit/summary", params={"date_from": "2026-11-01", "date_to": "2026-11-10"}, headers=admin_h).json()

    assert summary["totals"] == {
        "events": 6,
        "active_users": 2,
        "logins_ok": 2,
        "logins_blocked": 1,
        "accounts_locked": 0,
    }
    assert summary["login_methods"] == {"password": 1, "google": 1}
    assert summary["top_collections"] == [{"workspace_id": summary["top_collections"][0]["workspace_id"], "name": "Financeiro", "visits": 2}]
    assert summary["top_users"][0]["count"] == 3
    days = {d["date"]: d["count"] for d in summary["by_day"]}
    assert len(days) == 10 and days["2026-11-10"] == 2 and days["2026-11-05"] == 0
    assert sum(summary["by_hour"]) == 6 and len(summary["by_hour"]) == 24
    # Em Sao Paulo (UTC-3): 15:00 UTC e 12h, 16:00 e 13h, 12:00 e 9h, 13:00 (duas vezes) e 10h, 10:00 e 7h
    assert [h for h, n in enumerate(summary["by_hour"]) if n] == [7, 9, 10, 12, 13]
    assert summary["by_hour"][10] == 2
    assert summary["timezone"] == "America/Sao_Paulo"


def test_resumo_traz_os_relatorios_mais_abertos_com_o_nome_gravado(client, db_session):
    admin_h, admin, ana, workspace = _seed(client, db_session)
    for who, report_id, name in [(admin, 11, "Vendas"), (ana, 11, "Vendas"), (ana, 11, "Vendas"), (ana, 12, "Custos")]:
        _log(
            db_session,
            user=who,
            action="view_report",
            entity="report",
            workspace_id=workspace.id,
            details=name,
            entity_id=str(report_id),
            when="2026-11-10 15:00:00",
        )

    summary = client.get("/audit/summary", params={"date_from": "2026-11-01", "date_to": "2026-11-10"}, headers=admin_h).json()

    assert summary["top_reports"] == [
        {"report_id": "11", "name": "Vendas", "collection": "Financeiro", "visits": 3},
        {"report_id": "12", "name": "Custos", "collection": "Financeiro", "visits": 1},
    ]


def test_resumo_respeita_os_mesmos_filtros_da_tabela(client, db_session):
    admin_h, _, ana, _ = _seed(client, db_session)

    summary = client.get("/audit/summary", params={"user_id": ana["id"]}, headers=admin_h).json()

    assert summary["totals"]["events"] == 3
    assert summary["totals"]["active_users"] == 1
    assert summary["totals"]["logins_ok"] == 0
    assert summary["totals"]["logins_blocked"] == 1


def test_resumo_sem_registros_nao_quebra(client, db_session):
    admin_h, *_ = _login(client, "admin@example.com", "Admin")
    _clean(db_session)

    summary = client.get("/audit/summary", params={"date_from": "2026-01-01", "date_to": "2026-01-03"}, headers=admin_h).json()

    assert summary["totals"]["events"] == 0
    assert [d["count"] for d in summary["by_day"]] == [0, 0, 0]
    assert summary["by_action"] == [] and summary["top_users"] == [] and summary["top_collections"] == []
    assert summary["top_reports"] == []

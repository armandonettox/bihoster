"""Consulta generica dos visuais personalizados: medida repartida por um agrupamento."""

from datetime import datetime, timezone

from app.models.audit_log import AuditLog
from app.models.workspace import Workspace

PASSWORD = "SenhaForte123"


def _login(client, email: str, name: str) -> tuple[dict, dict]:
    client.post("/auth/register", json={"name": name, "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return headers, client.get("/auth/me", headers=headers).json()


def _add(db, user, action, when, *, entity="user", workspace_id=None, entity_id=None, details=None):
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


def _seed(client, db):
    """11 eventos entre 01/11 e 10/11 de 2026 (horarios em UTC; o sistema usa Sao Paulo, UTC-3)."""
    admin_h, a = _login(client, "admin@example.com", "Admin Geral")
    _, b = _login(client, "ana@example.com", "Ana Lima")
    ws = Workspace(name="Financeiro", slug="financeiro")
    db.add(ws)
    db.commit()
    db.query(AuditLog).delete()
    w = ws.id
    _add(db, a, "login", "2026-11-10 15:00:00")
    _add(db, a, "login", "2026-11-10 16:00:00", details="google")
    _add(db, b, "login_blocked", "2026-11-09 12:00:00")
    _add(db, b, "view_collection", "2026-11-09 13:00:00", entity="workspace", workspace_id=w, entity_id=str(w))
    _add(db, b, "view_collection", "2026-11-08 13:00:00", entity="workspace", workspace_id=w, entity_id=str(w))
    _add(db, a, "view_report", "2026-11-10 14:00:00", entity="report", workspace_id=w, entity_id="11", details="Vendas")
    _add(db, b, "view_report", "2026-11-10 14:30:00", entity="report", workspace_id=w, entity_id="11", details="Vendas")
    _add(db, b, "view_report", "2026-11-09 18:00:00", entity="report", workspace_id=w, entity_id="12", details="Custos")
    _add(db, a, "update", "2026-11-10 17:00:00", entity="workspace", workspace_id=w, entity_id=str(w))
    _add(db, None, "apply_update", "2026-11-01 10:00:00", entity="system", details="v1.9.0")
    _add(db, b, "account_locked", "2026-11-09 12:30:00")
    db.commit()
    return admin_h, a, b, w


def _q(client, headers, **params):
    return client.get("/audit/query", params=params, headers=headers)


def _rows(resp):
    return {r["key"]: r["value"] for r in resp.json()["rows"]}


def test_cada_medida_conta_o_que_diz(client, db_session):
    admin_h, *_ = _seed(client, db_session)
    expected = {
        "events": 11,
        "people": 2,
        "logins": 2,
        "logins_blocked": 1,
        "accounts_locked": 1,
        "report_opens": 3,
        "collection_visits": 2,
        "changes": 1,
    }

    for metric, value in expected.items():
        body = _q(client, admin_h, metric=metric).json()
        assert body["total"] == value, metric
        assert body["rows"] == [{"key": "total", "label": body["metric_label"], "value": value}], metric
        assert body["group_by"] == "none"


def test_por_dia_preenche_os_dias_sem_evento_dentro_do_periodo(client, db_session):
    admin_h, *_ = _seed(client, db_session)

    body = _q(client, admin_h, metric="events", group_by="day", date_from="2026-11-07", date_to="2026-11-10").json()

    assert [(r["key"], r["value"]) for r in body["rows"]] == [
        ("2026-11-07", 0),
        ("2026-11-08", 1),
        ("2026-11-09", 4),
        ("2026-11-10", 5),
    ]
    assert body["total"] == 10  # o evento de 01/11 fica fora do periodo


def test_por_hora_usa_o_fuso_do_sistema(client, db_session):
    admin_h, *_ = _seed(client, db_session)

    body = _q(client, admin_h, metric="events", group_by="hour").json()

    assert len(body["rows"]) == 24 and body["rows"][9]["label"] == "9h"
    counts = {r["key"]: r["value"] for r in body["rows"] if r["value"]}
    # 12:00 e 12:30 UTC = 9h e 9h30 em Sao Paulo; 15:00 UTC = 12h
    assert counts == {"7": 1, "9": 2, "10": 2, "11": 2, "12": 1, "13": 1, "14": 1, "15": 1}
    assert body["timezone"] == "America/Sao_Paulo"


def test_por_dia_da_semana(client, db_session):
    admin_h, *_ = _seed(client, db_session)

    body = _q(client, admin_h, metric="events", group_by="weekday").json()

    assert [r["label"] for r in body["rows"]] == ["Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado", "Domingo"]
    assert {r["label"]: r["value"] for r in body["rows"] if r["value"]} == {"Segunda": 4, "Terca": 5, "Domingo": 2}


def test_pessoas_ativas_conta_pessoas_diferentes_em_cada_dia(client, db_session):
    admin_h, *_ = _seed(client, db_session)

    by_day = _rows(_q(client, admin_h, metric="people", group_by="day", date_from="2026-11-08", date_to="2026-11-10"))
    by_user = _q(client, admin_h, metric="people", group_by="user").json()

    assert by_day == {"2026-11-08": 1, "2026-11-09": 1, "2026-11-10": 2}  # nao 5: a mesma pessoa conta uma vez
    assert by_user["total"] == 2
    assert {r["label"]: r["value"] for r in by_user["rows"]} == {"Admin Geral": 1, "Ana Lima": 1}


def test_por_acao_ordena_pelo_maior_corta_no_limite_e_o_total_nao_corta(client, db_session):
    admin_h, *_ = _seed(client, db_session)

    body = _q(client, admin_h, metric="events", group_by="action", limit=2).json()

    assert len(body["rows"]) == 2
    assert body["rows"][0] == {"key": "view_report", "label": "Relatorio aberto", "value": 3}
    assert body["total"] == 11  # o total e do periodo todo, nao dos 2 itens mostrados


def test_por_recurso_pessoa_colecao_e_relatorio(client, db_session):
    admin_h, a, b, w = _seed(client, db_session)

    by_entity = {r["label"]: r["value"] for r in _q(client, admin_h, metric="events", group_by="entity").json()["rows"]}
    by_user = [(r["label"], r["value"]) for r in _q(client, admin_h, metric="events", group_by="user").json()["rows"]]
    by_collection = _q(client, admin_h, metric="events", group_by="collection").json()["rows"]
    by_report = [(r["key"], r["label"], r["value"]) for r in _q(client, admin_h, metric="report_opens", group_by="report").json()["rows"]]

    assert by_entity == {"Usuario": 4, "Colecao": 3, "Relatorio": 3, "Sistema": 1}
    assert by_user == [("Ana Lima", 6), ("Admin Geral", 4)]  # evento sem pessoa nao entra
    assert by_collection == [{"key": str(w), "label": "Financeiro", "value": 6}]
    assert by_report == [("11", "Vendas", 2), ("12", "Custos", 1)]


def test_por_metodo_de_login_so_vale_para_logins(client, db_session):
    admin_h, *_ = _seed(client, db_session)

    ok = _q(client, admin_h, metric="logins", group_by="login_method").json()
    bad = _q(client, admin_h, metric="events", group_by="login_method")

    assert [(r["label"], r["value"]) for r in ok["rows"]] == [("Email e senha", 1), ("Google", 1)]
    assert bad.status_code == 422
    assert "Logins" in bad.json()["detail"]


def test_usa_os_mesmos_filtros_da_tabela(client, db_session):
    admin_h, a, b, w = _seed(client, db_session)

    assert _q(client, admin_h, metric="events", user_id=[b["id"]]).json()["total"] == 6
    assert _q(client, admin_h, metric="events", user_id=[a["id"], b["id"]]).json()["total"] == 10
    assert _q(client, admin_h, metric="events", action=["login", "login_blocked"]).json()["total"] == 3
    assert _q(client, admin_h, metric="events", entity=["report"]).json()["total"] == 3
    assert _q(client, admin_h, metric="events", workspace_id=[w]).json()["total"] == 6
    assert _q(client, admin_h, metric="events", report_id=[12]).json()["total"] == 1
    assert _q(client, admin_h, metric="events", date_from="2026-11-10", date_to="2026-11-10").json()["total"] == 5
    # Os filtros valem junto com a medida
    assert _q(client, admin_h, metric="logins", user_id=[b["id"]]).json()["total"] == 0


def test_sem_nenhum_evento_nao_quebra(client, db_session):
    admin_h, *_ = _seed(client, db_session)
    db_session.query(AuditLog).delete()
    db_session.commit()

    for group_by in ("none", "day", "hour", "weekday", "action", "entity", "user", "collection", "report"):
        resp = _q(client, admin_h, metric="events", group_by=group_by, date_from="2026-01-01", date_to="2026-01-03")
        assert resp.status_code == 200, group_by
        assert resp.json()["total"] == 0


def test_medida_ou_agrupamento_desconhecido_e_recusado(client, db_session):
    admin_h, *_ = _seed(client, db_session)

    assert _q(client, admin_h, metric="inventada").status_code == 422
    assert _q(client, admin_h, metric="events", group_by="inventado").status_code == 422
    assert _q(client, admin_h, metric="events", limit=0).status_code == 422
    assert _q(client, admin_h, metric="events", limit=51).status_code == 422
    assert client.get("/audit/query", headers=admin_h).status_code == 422  # medida e obrigatoria


def test_so_administrador_da_plataforma_consulta(client, db_session):
    _seed(client, db_session)
    comum_h, _ = _login(client, "comum@example.com", "Comum")

    assert _q(client, comum_h, metric="events").status_code == 403
    assert client.get("/audit/query", params={"metric": "events"}).status_code == 401

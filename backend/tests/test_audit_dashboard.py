"""Painel de Analiticos compartilhado: padrao, salvar layout, validar e restaurar."""

from app.core.audit_dashboard import GRID_COLUMNS, SOURCES_BY_TYPE, default_widgets

PASSWORD = "SenhaForte123"


def _login(client, email: str, name: str = "Pessoa") -> dict:
    client.post("/auth/register", json={"name": name, "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _admin(client) -> dict:
    return _login(client, "admin@example.com", "Admin")


def _widget(id_="w1", type_="stat", source="events", x=0, y=0, w=4, h=2, title=None) -> dict:
    return {"id": id_, "type": type_, "source": source, "title": title, "x": x, "y": y, "w": w, "h": h}


def test_sem_layout_salvo_vale_o_painel_padrao(client):
    admin = _admin(client)

    body = client.get("/audit/dashboard", headers=admin).json()

    assert body["is_default"] is True
    assert body["columns"] == GRID_COLUMNS
    assert len(body["widgets"]) == len(default_widgets())
    assert {w["type"] for w in body["widgets"]} == {"stat", "line", "bars", "hours", "donut"}
    assert body["updated_at"] is None


def test_o_painel_padrao_e_valido_e_sem_sobreposicao():
    widgets = default_widgets()
    ids = [w["id"] for w in widgets]
    assert len(ids) == len(set(ids))
    for w in widgets:
        assert w["source"] in SOURCES_BY_TYPE[w["type"]]
        assert w["x"] + w["w"] <= GRID_COLUMNS
    # Nenhum visual em cima de outro
    for i, a in enumerate(widgets):
        for b in widgets[i + 1 :]:
            separados = (
                a["x"] + a["w"] <= b["x"] or b["x"] + b["w"] <= a["x"] or a["y"] + a["h"] <= b["y"] or b["y"] + b["h"] <= a["y"]
            )
            assert separados, (a["id"], b["id"])


def test_salvar_o_layout_vale_para_todos_e_guarda_quem_salvou(client):
    admin = _admin(client)
    layout = {"widgets": [_widget("a", x=0, y=0), _widget("b", "line", "by_day", x=0, y=2, w=20, h=6, title="Minha linha")]}

    saved = client.put("/audit/dashboard", json=layout, headers=admin)

    assert saved.status_code == 200
    body = client.get("/audit/dashboard", headers=admin).json()
    assert body["is_default"] is False
    assert [w["id"] for w in body["widgets"]] == ["a", "b"]
    assert body["widgets"][1]["title"] == "Minha linha"
    assert body["updated_by"] == "admin@example.com"
    assert body["updated_at"] is not None


def test_titulo_em_branco_vira_sem_titulo(client):
    admin = _admin(client)

    resp = client.put("/audit/dashboard", json={"widgets": [_widget(title="   ")]}, headers=admin)

    assert resp.json()["widgets"][0]["title"] is None


def test_restaurar_volta_ao_padrao(client):
    admin = _admin(client)
    client.put("/audit/dashboard", json={"widgets": [_widget()]}, headers=admin)

    resp = client.delete("/audit/dashboard", headers=admin)

    assert resp.status_code == 200
    assert resp.json()["is_default"] is True
    assert len(resp.json()["widgets"]) == len(default_widgets())
    assert client.get("/audit/dashboard", headers=admin).json()["is_default"] is True


def test_layout_invalido_e_recusado_e_nada_e_gravado(client):
    admin = _admin(client)
    invalidos = {
        "fonte que nao serve ao tipo": {"widgets": [_widget(type_="line", source="events")]},
        "tipo desconhecido": {"widgets": [_widget(type_="pizza")]},
        "passa da largura": {"widgets": [_widget(x=18, w=4)]},
        "x fora da grade": {"widgets": [_widget(x=20)]},
        "largura zero": {"widgets": [_widget(w=0)]},
        "altura negativa": {"widgets": [_widget(h=-1)]},
        "ids repetidos": {"widgets": [_widget("a"), _widget("a", y=2)]},
        "id com caracteres estranhos": {"widgets": [_widget("a b<script>")]},
        "titulo grande demais": {"widgets": [_widget(title="x" * 81)]},
        "visuais demais": {"widgets": [_widget(f"w{i}", y=i) for i in range(41)]},
    }

    for nome, layout in invalidos.items():
        assert client.put("/audit/dashboard", json=layout, headers=admin).status_code == 422, nome

    assert client.get("/audit/dashboard", headers=admin).json()["is_default"] is True


def test_painel_vazio_e_permitido(client):
    admin = _admin(client)

    assert client.put("/audit/dashboard", json={"widgets": []}, headers=admin).status_code == 200
    body = client.get("/audit/dashboard", headers=admin).json()

    assert body["widgets"] == [] and body["is_default"] is False


def test_layout_salvo_que_ficou_invalido_volta_ao_padrao_sem_quebrar(client, db_session):
    from app.models.audit_dashboard import AuditDashboard

    admin = _admin(client)
    db_session.add(AuditDashboard(id=1, layout='{"widgets": [{"id": "x", "type": "stat", "source": "sumiu", "x": 0, "y": 0, "w": 1, "h": 1}]}'))
    db_session.commit()

    resp = client.get("/audit/dashboard", headers=admin)

    assert resp.status_code == 200
    assert resp.json()["is_default"] is True


def test_so_administrador_da_plataforma_acessa(client):
    _admin(client)
    comum = _login(client, "comum@example.com", "Comum")

    for call in (
        lambda h: client.get("/audit/dashboard", headers=h),
        lambda h: client.put("/audit/dashboard", json={"widgets": []}, headers=h),
        lambda h: client.delete("/audit/dashboard", headers=h),
    ):
        assert call(comum).status_code == 403
        assert call({}).status_code == 401


def test_salvar_e_restaurar_ficam_na_auditoria(client):
    admin = _admin(client)
    client.put("/audit/dashboard", json={"widgets": [_widget()]}, headers=admin)
    client.delete("/audit/dashboard", headers=admin)

    items = client.get("/audit/search", params={"entity": ["dashboard"]}, headers=admin).json()["items"]

    assert {i["action"] for i in items} == {"update_dashboard", "reset_dashboard"}
    assert {i["action_label"] for i in items} == {"Painel de analiticos alterado", "Painel de analiticos restaurado"}
    assert {i["entity_label"] for i in items} == {"Painel"}


# --- visuais personalizados (medida + agrupamento), cor e tabela ---


def _custom(id_="c1", type_="bars", metric="events", group_by="action", limit=8, color=None, title=None, **pos) -> dict:
    base = {"x": 0, "y": 0, "w": 10, "h": 7}
    base.update(pos)
    return {
        "id": id_,
        "type": type_,
        "source": "custom",
        "title": title,
        "color": color,
        "query": {"metric": metric, "group_by": group_by, "limit": limit},
        **base,
    }


def test_salva_visuais_personalizados_de_todos_os_tipos_com_cor_e_consulta(client):
    admin = _admin(client)
    widgets = [
        _custom("a", "stat", "logins", "none", x=0, y=0, w=4, h=2, color="danger"),
        _custom("b", "line", "events", "day", x=0, y=2, w=20, h=6, title="Eventos"),
        _custom("c", "bars", "people", "collection", x=0, y=8, color="accent"),
        _custom("d", "donut", "logins", "login_method", x=10, y=8),
        _custom("e", "table", "report_opens", "report", limit=15, x=0, y=15),
        _widget("f", "hours", "by_hour", x=10, y=15, w=10, h=6),
    ]

    resp = client.put("/audit/dashboard", json={"widgets": widgets}, headers=admin)

    assert resp.status_code == 200, resp.text
    saved = {w["id"]: w for w in client.get("/audit/dashboard", headers=admin).json()["widgets"]}
    assert saved["a"]["color"] == "danger" and saved["a"]["query"] == {"metric": "logins", "group_by": "none", "limit": 8, "filters": None}
    assert saved["e"]["query"]["limit"] == 15 and saved["e"]["type"] == "table"
    assert saved["f"]["query"] is None and saved["f"]["color"] is None  # visual padrao continua como era


def test_visuais_padrao_aceitam_cor_e_titulo(client):
    admin = _admin(client)

    resp = client.put(
        "/audit/dashboard", json={"widgets": [{**_widget("a", "stat", "events"), "color": "accent", "title": "Total"}]}, headers=admin
    )

    assert resp.status_code == 200
    assert resp.json()["widgets"][0]["color"] == "accent"


def test_visual_personalizado_invalido_e_recusado(client):
    admin = _admin(client)
    invalidos = {
        "personalizado sem consulta": [{**_custom(), "query": None}],
        "visual padrao com consulta": [{**_widget(), "query": {"metric": "events", "group_by": "none"}}],
        "cartao agrupado": [_custom("a", "stat", "events", "action", w=4, h=2)],
        "barras sem agrupamento": [_custom("a", "bars", "events", "none")],
        "linha agrupada por categoria": [_custom("a", "line", "events", "action")],
        "rosca por dia": [_custom("a", "donut", "events", "day")],
        "tabela sem agrupamento": [_custom("a", "table", "events", "none")],
        "metodo de login com outra medida": [_custom("a", "bars", "events", "login_method")],
        "medida desconhecida": [_custom("a", "bars", "inventada", "action")],
        "agrupamento desconhecido": [_custom("a", "bars", "events", "inventado")],
        "limite zero": [_custom("a", "bars", "events", "action", limit=0)],
        "limite grande demais": [_custom("a", "bars", "events", "action", limit=51)],
        "cor fora do tema": [_custom("a", "bars", color="rosa")],
        "tabela com fonte padrao": [_widget("a", "table", "by_action")],
        "horas personalizado": [{**_custom("a", "hours", "events", "hour")}],
    }

    for nome, widgets in invalidos.items():
        assert client.put("/audit/dashboard", json={"widgets": widgets}, headers=admin).status_code == 422, nome

    assert client.get("/audit/dashboard", headers=admin).json()["is_default"] is True


def test_painel_padrao_continua_sem_consulta_nem_cor(client):
    admin = _admin(client)

    widgets = client.get("/audit/dashboard", headers=admin).json()["widgets"]

    assert all(w["query"] is None and w["color"] is None for w in widgets)


# --- filtros proprios de cada visual ---


def _com_filtros(filters: dict, **kw) -> dict:
    widget = _custom("f1", "stat", "logins", "none", w=4, h=2, **kw)
    widget["query"] = {**widget["query"], "filters": filters}
    return widget


def test_guarda_os_filtros_do_visual_sem_repetidos(client):
    admin = _admin(client)
    filtros = {"action": ["login", "login", " view_report "], "workspace_id": [3, 3, 5], "user_id": [], "entity": ["report"]}

    resp = client.put("/audit/dashboard", json={"widgets": [_com_filtros(filtros)]}, headers=admin)

    assert resp.status_code == 200, resp.text
    saved = client.get("/audit/dashboard", headers=admin).json()["widgets"][0]["query"]["filters"]
    assert saved == {"user_id": [], "action": ["login", "view_report"], "workspace_id": [3, 5], "report_id": [], "entity": ["report"]}


def test_filtros_todos_vazios_valem_como_visual_sem_filtro(client):
    admin = _admin(client)

    resp = client.put("/audit/dashboard", json={"widgets": [_com_filtros({"action": [], "user_id": []})]}, headers=admin)

    assert resp.status_code == 200, resp.text
    assert resp.json()["widgets"][0]["query"]["filters"] is None


def test_recusa_filtros_invalidos(client):
    admin = _admin(client)
    invalidos = {
        "acao vazia": {"action": [""]},
        "texto grande demais": {"entity": ["x" * 41]},
        "id que nao e numero": {"user_id": ["abc"]},
        "valores demais": {"workspace_id": list(range(51))},
    }

    for nome, filtros in invalidos.items():
        resp = client.put("/audit/dashboard", json={"widgets": [_com_filtros(filtros)]}, headers=admin)
        assert resp.status_code == 422, nome


def test_visual_padrao_nao_aceita_filtros(client):
    admin = _admin(client)
    widget = {**_widget("a", "stat", "events"), "query": {"metric": "events", "group_by": "none", "filters": {"action": ["login"]}}}

    assert client.put("/audit/dashboard", json={"widgets": [widget]}, headers=admin).status_code == 422

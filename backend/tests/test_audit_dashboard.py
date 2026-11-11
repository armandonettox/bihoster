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

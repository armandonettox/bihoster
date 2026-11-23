"""Os módulos Alertas e Assinaturas: a visão de todo o portal (`/alerts/` e `/subscriptions/`) e a lista de relatórios onde
dá para criar um item novo (`/alerts/reports` e `/subscriptions/reports`). Ver tudo exige a permissão global; criar,
editar e excluir continuam valendo pelas permissões da coleção e pela regra do que é da própria pessoa."""

import pytest

from app.models.alert import ReportAlert
from app.models.user import User
from tests.test_subscriptions_api import _criar, _headers, _pbi, cenario  # noqa: F401  (cenario é fixture)


def _id_da_pessoa(client, admin, email):
    return next(u["id"] for u in client.get("/users/", headers=admin).json() if u["email"] == email)


def _dar_global(client, c, chave):
    """Dá à `pessoa` uma permissão do sistema todo, sem mexer no que ela tem nas coleções."""
    uid = _id_da_pessoa(client, c.admin, "pessoa@empresa.com")
    atuais = client.get(f"/access/users/{uid}", headers=c.admin).json()
    blocos = [
        {"workspace_id": b["workspace_id"], "permissions": b["permissions"]}
        for b in atuais.get("blocks", [])
        if b.get("permissions")
    ]
    blocos.append({"workspace_id": None, "permissions": [chave]})
    resp = client.put(f"/access/users/{uid}", json={"blocks": blocos}, headers=c.admin)
    assert resp.status_code == 200, resp.text


def _alerta(db_session, relatorio, criado_por_email=None, nome="Meta", medida="Total"):
    dono = db_session.query(User).filter(User.email == criado_por_email).first() if criado_por_email else None
    alerta = ReportAlert(
        report_id=relatorio["id"],
        created_by_id=dono.id if dono else None,
        created_by_name=dono.name if dono else None,
        name=nome,
        measure_name=medida,
        condition=">",
        threshold=10.0,
        check_interval_minutes=60,
        cooldown_hours=24,
        enabled=True,
    )
    alerta.recipients = ["gestor@empresa.com"]
    db_session.add(alerta)
    db_session.commit()
    return alerta.id


MODULOS = [
    pytest.param("/alerts/", "/alerts/reports", "alerta.todas", id="alertas"),
    pytest.param("/subscriptions/", "/subscriptions/reports", "assinatura.todas", id="assinaturas"),
]


class TestPermissaoDaVisaoGeral:
    @pytest.mark.parametrize(("lista", "relatorios", "chave"), MODULOS)
    def test_sem_entrar_no_sistema_recusa(self, client, cenario, lista, relatorios, chave):
        assert client.get(lista).status_code == 401
        assert client.get(relatorios).status_code == 401

    @pytest.mark.parametrize(("lista", "relatorios", "chave"), MODULOS)
    def test_quem_so_e_editor_de_uma_colecao_nao_ve_a_visao_do_portal(self, client, cenario, lista, relatorios, chave):
        assert client.get(lista, headers=cenario.pessoa).status_code == 403
        assert client.get(relatorios, headers=cenario.pessoa).status_code == 403

    @pytest.mark.parametrize(("lista", "relatorios", "chave"), MODULOS)
    def test_com_a_permissao_global_abre_as_duas_rotas(self, client, cenario, lista, relatorios, chave):
        _dar_global(client, cenario, chave)

        assert client.get(lista, headers=cenario.pessoa).status_code == 200
        assert client.get(relatorios, headers=cenario.pessoa).status_code == 200

    @pytest.mark.parametrize(("lista", "relatorios", "chave"), MODULOS)
    def test_administrador_da_plataforma_abre_sem_ter_a_permissao_marcada(self, client, cenario, lista, relatorios, chave):
        assert client.get(lista, headers=cenario.admin).status_code == 200
        assert client.get(relatorios, headers=cenario.admin).status_code == 200

    def test_a_permissao_nova_existe_no_catalogo_e_e_global(self):
        from app.core.access_catalog import GLOBAL, get

        assert get("alerta.todas") is not None
        assert get("alerta.todas").scope == GLOBAL
        assert get("alerta.todas").requires == ()


class TestAlertasDeTodoOPortal:
    def test_traz_os_alertas_de_todas_as_colecoes_com_o_nome_da_colecao_e_do_relatorio(self, client, cenario, db_session):
        a = _alerta(db_session, cenario.rel_a, nome="Alerta da A")
        b = _alerta(db_session, cenario.rel_b, nome="Alerta da B")

        lista = client.get("/alerts/", headers=cenario.admin).json()

        assert [item["id"] for item in lista] == [a, b]
        assert lista[0]["collection_name"] == "A"
        assert lista[0]["report_name"] == "Relatorio A"
        assert lista[1]["collection_name"] == "B"
        assert lista[1]["name"] == "Alerta da B"

    def test_vazio_quando_nao_ha_alertas(self, client, cenario):
        assert client.get("/alerts/", headers=cenario.admin).json() == []

    def test_o_administrador_pode_editar_e_excluir_todos(self, client, cenario, db_session):
        _alerta(db_session, cenario.rel_a, criado_por_email="pessoa@empresa.com")
        _alerta(db_session, cenario.rel_b)

        lista = client.get("/alerts/", headers=cenario.admin).json()

        assert all(item["can_edit"] and item["can_delete"] for item in lista)

    def test_a_pessoa_so_pode_mexer_no_que_ela_criou_e_so_onde_e_editora(self, client, cenario, db_session):
        _dar_global(client, cenario, "alerta.todas")
        minha_na_a = _alerta(db_session, cenario.rel_a, criado_por_email="pessoa@empresa.com", nome="Minha")
        de_outro_na_a = _alerta(db_session, cenario.rel_a, nome="De outro")
        _alerta(db_session, cenario.rel_b, criado_por_email="pessoa@empresa.com", nome="Minha na B")

        lista = {item["id"]: item for item in client.get("/alerts/", headers=cenario.pessoa).json()}

        # Editora na A: mexe no que criou, mas não no que outra pessoa criou (falta a permissão "de outras pessoas")
        assert lista[minha_na_a]["can_edit"] is True and lista[minha_na_a]["can_delete"] is True
        assert lista[de_outro_na_a]["can_edit"] is False and lista[de_outro_na_a]["can_delete"] is False
        # Leitora na B: não mexe em nada, nem no que ela mesma criou
        na_b = next(item for item in lista.values() if item["collection_name"] == "B")
        assert na_b["can_edit"] is False and na_b["can_delete"] is False

    def test_a_visao_do_portal_mostra_tudo_mas_a_edicao_continua_pela_rota_da_colecao(self, client, cenario, db_session):
        _dar_global(client, cenario, "alerta.todas")
        alheio = _alerta(db_session, cenario.rel_a, nome="De outro")
        base = f"/workspaces/{cenario.ws_a['id']}/alerts/{alheio}"

        # Aparece na lista global, mas a rota da coleção recusa a edição e a exclusão
        assert alheio in [item["id"] for item in client.get("/alerts/", headers=cenario.pessoa).json()]
        assert client.put(base, json={"threshold": 99}, headers=cenario.pessoa).status_code == 403
        assert client.delete(base, headers=cenario.pessoa).status_code == 403

    def test_editar_pela_rota_da_colecao_aparece_na_lista_do_portal(self, client, cenario, db_session):
        alerta = _alerta(db_session, cenario.rel_a)
        base = f"/workspaces/{cenario.ws_a['id']}/alerts/{alerta}"

        assert client.put(base, json={"threshold": 77, "enabled": False}, headers=cenario.admin).status_code == 200

        item = client.get("/alerts/", headers=cenario.admin).json()[0]
        assert item["threshold"] == 77 and item["enabled"] is False

    def test_excluir_pela_rota_da_colecao_some_da_lista_do_portal(self, client, cenario, db_session):
        alerta = _alerta(db_session, cenario.rel_a)

        assert client.delete(f"/workspaces/{cenario.ws_a['id']}/alerts/{alerta}", headers=cenario.admin).status_code == 204

        assert client.get("/alerts/", headers=cenario.admin).json() == []


class TestRelatoriosOndeDaParaCriar:
    @pytest.mark.parametrize(("lista", "relatorios", "chave"), MODULOS)
    def test_o_administrador_ve_os_relatorios_de_todas_as_colecoes_em_ordem(self, client, cenario, lista, relatorios, chave):
        itens = client.get(relatorios, headers=cenario.admin).json()

        assert [(i["collection_name"], i["report_name"]) for i in itens] == [("A", "Relatorio A"), ("B", "Relatorio B")]
        assert set(itens[0]) == {"report_id", "report_name", "collection_id", "collection_name"}
        assert itens[0]["report_id"] == cenario.rel_a["id"] and itens[0]["collection_id"] == cenario.ws_a["id"]

    @pytest.mark.parametrize(("lista", "relatorios", "chave"), MODULOS)
    def test_a_pessoa_so_ve_onde_pode_criar_que_e_a_colecao_onde_ela_e_editora(self, client, cenario, lista, relatorios, chave):
        _dar_global(client, cenario, chave)

        itens = client.get(relatorios, headers=cenario.pessoa).json()

        # Editora na A (cria alertas e assinaturas), leitora na B (não cria)
        assert [i["collection_name"] for i in itens] == ["A"]

    @pytest.mark.parametrize(("lista", "relatorios", "chave"), MODULOS)
    def test_sem_nenhum_relatorio_a_lista_vem_vazia(self, client, lista, relatorios, chave):
        admin = _headers(client, "sozinho@empresa.com")

        assert client.get(relatorios, headers=admin).json() == []


class TestAssinaturasDeTodoOPortal:
    def test_a_lista_do_portal_diz_o_que_cada_pessoa_pode_fazer_com_cada_assinatura(self, client, cenario):
        propria = _criar(client, cenario, headers=cenario.pessoa).json()
        alheia = _criar(client, cenario).json()  # criada pelo administrador, na mesma coleção
        _dar_global(client, cenario, "assinatura.todas")

        lista = {item["id"]: item for item in client.get("/subscriptions/", headers=cenario.pessoa).json()}

        assert lista[propria["id"]]["can_edit"] is True
        assert lista[propria["id"]]["can_delete"] is True
        assert lista[propria["id"]]["can_run"] is True
        assert lista[alheia["id"]]["can_edit"] is False
        assert lista[alheia["id"]]["can_delete"] is False
        assert lista[alheia["id"]]["can_run"] is False

    def test_o_administrador_pode_tudo_em_todas(self, client, cenario):
        _criar(client, cenario, headers=cenario.pessoa)
        _criar(client, cenario, ws=cenario.ws_b, rel=cenario.rel_b)

        lista = client.get("/subscriptions/", headers=cenario.admin).json()

        assert len(lista) == 2
        assert all(item["can_edit"] and item["can_delete"] and item["can_run"] for item in lista)

    def test_a_edicao_continua_pela_rota_da_colecao_e_aparece_na_lista_do_portal(self, client, cenario):
        sub = _criar(client, cenario).json()
        base = f"/workspaces/{cenario.ws_a['id']}/subscriptions/{sub['id']}"
        p1, p2 = _pbi()

        with p1, p2:
            resp = client.put(base, json={"name": "Renomeada", "enabled": False}, headers=cenario.admin)

        assert resp.status_code == 200
        item = client.get("/subscriptions/", headers=cenario.admin).json()[0]
        assert item["name"] == "Renomeada" and item["enabled"] is False

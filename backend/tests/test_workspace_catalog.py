"""O modulo "Relatorios" (v1.51.0): workspaces, itens, painel de permissoes, permissoes de modelo semantico e lotes. A API do
Power BI e sempre simulada e os dados sao ficticios."""

from unittest.mock import MagicMock, patch

import pytest

from app.core import access_catalog, dataset_access, powerbi as powerbi_core
from app.core.access_engine import effective_access
from app.core.root_collection import ensure_root_collection
from app.core.workspace_catalog import ensure_datasets_for_reports
from app.models.access_grant import AccessGrant
from app.models.catalog_sync import DatasetRoleGrant, PbiDataset
from app.models.dataset_grant import DatasetGrant, DatasetInviteGrant
from app.models.invite import GroupInvite
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.report_grant import ReportCollection, ReportGrant, ReportInviteGrant
from app.models.user import User
from app.models.workspace import Group, GroupMember, Workspace

PASSWORD = "SenhaForte123"


def _entrar(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def cena(client, db_session):
    """Dois workspaces do tenant: A (tres relatorios, dois modelos) e B (um relatorio sem modelo). Dois relatorios novos
    estao na Raiz e um ja esta publicado na pasta Financeiro. Tres pessoas e dois grupos."""
    admin = _entrar(client, "admin@example.com")
    ana = _entrar(client, "ana@example.com")
    beto = _entrar(client, "beto@example.com")
    caio = _entrar(client, "caio@example.com")
    ids = {u.email: u.id for u in db_session.query(User).all()}
    conexao = PowerBIConnection(name="Conta ficticia", tenant_id="t", client_id="c", client_secret="s")
    db_session.add(conexao)
    db_session.commit()
    raiz = ensure_root_collection(db_session)
    financeiro = Workspace(name="Financeiro", slug="financeiro")
    db_session.add(financeiro)
    db_session.commit()

    def relatorio(nome, colecao, workspace, nome_ws, dataset=None):
        r = Report(
            collection_id=colecao.id, name=nome, powerbi_connection_id=conexao.id, pbi_workspace_id=workspace,
            pbi_workspace_name=nome_ws, pbi_report_id=f"rep-{nome}", pbi_dataset_id=dataset, source="sync",
        )
        db_session.add(r)
        db_session.commit()
        return r

    r1 = relatorio("Resultado", raiz, "ws-a", "Financeiro do tenant", "ds-1")
    r2 = relatorio("Fluxo", raiz, "ws-a", "Financeiro do tenant", "ds-1")
    r3 = relatorio("Custos", financeiro, "ws-a", "Financeiro do tenant", "ds-2")
    r4 = relatorio("Vendas", raiz, "ws-b", "Comercial do tenant")
    grupo = Group(name="Turma de dados")
    outro = Group(name="Diretoria")
    db_session.add_all([grupo, outro])
    db_session.commit()
    return {
        "admin": admin, "ana": ana, "beto": beto, "caio": caio,
        "ana_id": ids["ana@example.com"], "beto_id": ids["beto@example.com"], "caio_id": ids["caio@example.com"],
        "conexao": conexao, "raiz": raiz, "financeiro": financeiro, "r1": r1, "r2": r2, "r3": r3, "r4": r4, "grupo": grupo, "outro": outro,
    }


def _dataset(db_session, cena, pbi_id, nome=None):
    ensure_datasets_for_reports(db_session)
    db_session.commit()
    dataset = db_session.query(PbiDataset).filter_by(pbi_dataset_id=pbi_id).one()
    if nome:
        dataset.name = nome
        db_session.commit()
    return dataset


class TestListaDeModelosVazia:
    """O bug: a lista de modelos so olhava a sincronizacao e ficava vazia ate alguem sincronizar, mesmo com relatorios que usam modelos."""

    def test_reproduz_o_bug_sem_sincronizacao_a_tabela_esta_vazia(self, db_session, cena):
        assert db_session.query(PbiDataset).count() == 0  # nada sincronizado: foi o que aconteceu em producao

    def test_a_lista_traz_os_modelos_dos_relatorios_com_o_id_curto_como_nome(self, client, db_session, cena):
        dados = client.get("/catalog/datasets", headers=cena["admin"]).json()

        nomes = sorted(i["name"] for i in dados["items"])
        assert dados["total"] == 2 and nomes == ["Modelo ds-1", "Modelo ds-2"]
        assert {i["pbi_workspace_name"] for i in dados["items"]} == {"Financeiro do tenant"}
        por_nome = {i["name"]: i for i in dados["items"]}
        assert por_nome["Modelo ds-1"]["reports_count"] == 2 and por_nome["Modelo ds-2"]["reports_count"] == 1

    def test_e_idempotente_e_nao_duplica_a_cada_consulta(self, client, db_session, cena):
        client.get("/catalog/datasets", headers=cena["admin"])
        client.get("/catalog/datasets", headers=cena["admin"])

        assert db_session.query(PbiDataset).count() == 2

    def test_a_sincronizacao_troca_o_id_curto_pelo_nome_da_api(self, client, db_session, cena, monkeypatch):
        from app.core import catalog_sync

        client.get("/catalog/datasets", headers=cena["admin"])
        monkeypatch.setattr(powerbi_core, "list_workspaces", lambda c: [{"id": "ws-a", "name": "Financeiro do tenant"}])
        monkeypatch.setattr(powerbi_core, "list_reports", lambda c, w: [{"id": "rep-Resultado", "name": "Resultado", "datasetId": "ds-1"}])
        monkeypatch.setattr(powerbi_core, "list_datasets", lambda c, w: [{"id": "ds-1", "name": "Modelo financeiro", "isEffectiveIdentityRequired": True}])
        monkeypatch.setattr(catalog_sync, "_sleep", lambda s: None)

        catalog_sync.sync_connection(db_session, cena["conexao"])

        nomes = {d.pbi_dataset_id: d.name for d in db_session.query(PbiDataset)}
        assert nomes == {"ds-1": "Modelo financeiro", "ds-2": "Modelo ds-2"}  # o que a API nao trouxe continua na lista

    def test_modelo_sem_relatorio_nenhum_vindo_so_da_api_tambem_aparece(self, client, db_session, cena):
        db_session.add(PbiDataset(connection_id=cena["conexao"].id, pbi_workspace_id="ws-a", pbi_workspace_name="Financeiro do tenant", pbi_dataset_id="ds-9", name="Modelo solto"))
        db_session.commit()

        nomes = {i["name"] for i in client.get("/catalog/datasets", headers=cena["admin"]).json()["items"]}

        assert nomes == {"Modelo solto", "Modelo ds-1", "Modelo ds-2"}


class TestWorkspaces:
    def test_lista_com_contagens_e_pendentes(self, client, cena):
        dados = {w["name"]: w for w in client.get("/catalog/workspaces", headers=cena["admin"]).json()}

        assert set(dados) == {"Financeiro do tenant", "Comercial do tenant"}
        fin = dados["Financeiro do tenant"]
        assert (fin["reports"], fin["datasets"], fin["pending"]) == (3, 2, 2)  # Resultado e Fluxo estao na Raiz sem acesso
        assert dados["Comercial do tenant"]["pending"] == 1 and dados["Comercial do tenant"]["datasets"] == 0

    def test_busca_pelo_nome(self, client, cena):
        dados = client.get("/catalog/workspaces", params={"search": "comerc"}, headers=cena["admin"]).json()

        assert [w["name"] for w in dados] == ["Comercial do tenant"]

    def test_quem_nao_tem_nada_recebe_lista_vazia(self, client, cena):
        assert client.get("/catalog/workspaces", headers=cena["caio"]).json() == []

    def test_quem_so_recebeu_um_relatorio_ve_so_o_workspace_dele(self, client, cena):
        client.put(f"/access-panel/report/{cena['r4'].id}/user/{cena['ana_id']}", json={"preset": "ver"}, headers=cena["admin"])

        dados = client.get("/catalog/workspaces", headers=cena["ana"]).json()

        assert [(w["name"], w["reports"], w["datasets"]) for w in dados] == [("Comercial do tenant", 1, 0)]

    def test_relatorio_publicado_ou_com_acesso_deixa_de_ser_pendente(self, client, db_session, cena):
        client.put(f"/access-panel/report/{cena['r1'].id}/group/{cena['grupo'].id}", json={"preset": "ver"}, headers=cena["admin"])

        dados = {w["name"]: w for w in client.get("/catalog/workspaces", headers=cena["admin"]).json()}

        assert dados["Financeiro do tenant"]["pending"] == 1  # so o Fluxo


class TestItens:
    def _itens(self, client, cena, quem="admin", **params):
        return client.get("/catalog/items", params=params, headers=cena[quem]).json()

    def test_mistura_relatorios_e_modelos_do_workspace(self, client, cena):
        dados = self._itens(client, cena, workspace="ws-a")

        tipos = sorted((i["kind"], i["name"]) for i in dados["items"])
        assert tipos == [("dataset", "Modelo ds-1"), ("dataset", "Modelo ds-2"), ("report", "Custos"), ("report", "Fluxo"), ("report", "Resultado")]
        assert dados["total"] == 5 and dados["pending_total"] == 2

    def test_filtro_por_tipo_e_busca(self, client, cena):
        assert {i["name"] for i in self._itens(client, cena, workspace="ws-a", kind="report")["items"]} == {"Custos", "Fluxo", "Resultado"}
        assert [i["name"] for i in self._itens(client, cena, workspace="ws-a", kind="dataset", search="ds-2")["items"]] == ["Modelo ds-2"]
        assert [i["name"] for i in self._itens(client, cena, search="flu")["items"]] == ["Fluxo"]

    def test_pagina_ordena_e_nunca_devolve_tudo_de_uma_vez(self, client, cena):
        primeira = self._itens(client, cena, workspace="ws-a", page_size=2)
        segunda = self._itens(client, cena, workspace="ws-a", page_size=2, page=2)

        assert len(primeira["items"]) == 2 and len(segunda["items"]) == 2 and primeira["total"] == 5
        assert not ({i["name"] for i in primeira["items"]} & {i["name"] for i in segunda["items"]})
        decrescente = self._itens(client, cena, workspace="ws-a", kind="report", order="desc")
        assert [i["name"] for i in decrescente["items"]] == ["Resultado", "Fluxo", "Custos"]

    def test_tamanho_de_pagina_acima_do_limite_e_recusado(self, client, cena):
        assert client.get("/catalog/items", params={"page_size": 101}, headers=cena["admin"]).status_code == 422

    def test_pendentes_so_os_novos_sem_acesso(self, client, cena):
        dados = self._itens(client, cena, pending=True)

        assert {i["name"] for i in dados["items"]} == {"Resultado", "Fluxo", "Vendas"} and all(i["pending"] for i in dados["items"])

    def test_diz_as_pastas_o_modelo_e_o_rls_de_cada_relatorio(self, client, db_session, cena):
        ds1 = _dataset(db_session, cena, "ds-1", "Modelo financeiro")
        ds1.is_effective_identity_required = True
        db_session.add(DatasetRoleGrant(dataset_id=ds1.id, group_id=cena["grupo"].id, pbi_role="Regional A"))
        db_session.add(ReportCollection(report_id=cena["r3"].id, collection_id=db_session.query(Workspace).filter_by(slug="raiz").one().id))
        db_session.commit()

        itens = {i["name"]: i for i in self._itens(client, cena, workspace="ws-a", kind="report")["items"]}

        assert itens["Custos"]["folders"][0] == "Financeiro" and itens["Resultado"]["folders"] == [] and itens["Resultado"]["in_root"] is True
        assert itens["Resultado"]["dataset_name"] == "Modelo financeiro"
        assert itens["Resultado"]["rls"] == {"requires_identity": True, "role_grants": 1}

    def test_a_pilha_de_acesso_conta_quem_tem_acesso_direto(self, client, cena):
        client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['ana_id']}", json={"preset": "ver"}, headers=cena["admin"])
        client.put(f"/access-panel/report/{cena['r1'].id}/group/{cena['grupo'].id}", json={"preset": "exportar"}, headers=cena["admin"])

        itens = {i["name"]: i for i in self._itens(client, cena, workspace="ws-a", kind="report")["items"]}

        assert itens["Resultado"]["access"]["count"] == 2
        assert {(f["kind"], f["name"]) for f in itens["Resultado"]["access"]["people"]} == {("user", "Ana"), ("group", "Turma de dados")}
        assert itens["Fluxo"]["access"] == {"count": 0, "people": []}

    def test_ordenar_por_acesso(self, client, cena):
        client.put(f"/access-panel/report/{cena['r2'].id}/user/{cena['ana_id']}", json={"preset": "ver"}, headers=cena["admin"])

        nomes = [i["name"] for i in self._itens(client, cena, workspace="ws-a", kind="report", sort="access", order="desc")["items"]]

        assert nomes[0] == "Fluxo"

    def test_o_que_a_pessoa_pode_em_cada_item(self, client, db_session, cena):
        ds1 = _dataset(db_session, cena, "ds-1")
        client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['ana_id']}", json={"preset": "exportar"}, headers=cena["admin"])
        client.put(f"/access-panel/dataset/{ds1.id}/user/{cena['ana_id']}", json={"preset": "atualizar"}, headers=cena["admin"])

        itens = {(i["kind"], i["name"]): i for i in self._itens(client, cena, quem="ana")["items"]}

        assert set(itens) == {("report", "Resultado"), ("dataset", ds1.name)}
        assert itens[("report", "Resultado")]["can"] == {"open": True, "share": False, "security": False, "refresh": False, "history": False, "folders": False}
        assert itens[("dataset", ds1.name)]["can"] == {"open": False, "share": False, "security": False, "refresh": True, "history": True, "folders": False}

    def test_quem_so_tem_o_modelo_nao_ve_os_relatorios_dele(self, client, db_session, cena):
        ds1 = _dataset(db_session, cena, "ds-1")
        client.put(f"/access-panel/dataset/{ds1.id}/user/{cena['ana_id']}", json={"preset": "ver"}, headers=cena["admin"])

        itens = self._itens(client, cena, quem="ana")["items"]

        assert [(i["kind"]) for i in itens] == ["dataset"]
        assert client.get(f"/workspaces/{cena['r1'].collection_id}/powerbi/reports/{cena['r1'].id}/embed", headers=cena["ana"]).status_code == 403

    def test_quem_nao_tem_nada_nao_ve_itens(self, client, cena):
        assert self._itens(client, cena, quem="caio") == {"items": [], "total": 0, "page": 1, "page_size": 25, "pending_total": 0}


class TestPainel:
    def _painel(self, client, cena, kind, item_id, quem="admin"):
        return client.get(f"/access-panel/{kind}/{item_id}", headers=cena[quem])

    def test_lista_quem_tem_acesso_com_preset_e_origem(self, client, db_session, cena):
        client.put(f"/access-panel/report/{cena['r3'].id}/user/{cena['ana_id']}", json={"permissions": ["relatorio.ver", "relatorio.exportar", "relatorio.editar"]}, headers=cena["admin"])
        db_session.add(AccessGrant(group_id=cena["outro"].id, workspace_id=cena["financeiro"].id, permission_key="colecao.ver"))
        db_session.add(AccessGrant(user_id=cena["beto_id"], workspace_id=cena["financeiro"].id, permission_key="colecao.ver"))
        db_session.commit()

        dados = self._painel(client, cena, "report", cena["r3"].id).json()

        entradas = {(e["subject_kind"], e["name"]): e for e in dados["entries"]}
        assert set(entradas) == {("user", "Ana"), ("group", "Diretoria"), ("user", "Beto")}
        assert entradas[("user", "Ana")]["preset"] == "personalizado" and entradas[("user", "Ana")]["origins"] == [{"kind": "direct", "label": "Direto"}]
        assert entradas[("group", "Diretoria")]["origins"] == [{"kind": "folder", "label": "Financeiro"}]
        assert entradas[("group", "Diretoria")]["effective"] == ["relatorio.ver"] and entradas[("group", "Diretoria")]["permissions"] == []
        assert [p["key"] for p in dados["presets"]] == ["ver", "exportar", "gerenciar"]
        assert dados["can_manage"] is True

    def test_a_origem_herdada_vem_da_pasta_de_cima(self, client, db_session, cena):
        pai = Workspace(name="Diretoria geral", slug="diretoria-geral")
        db_session.add(pai)
        db_session.commit()
        cena["financeiro"].parent_id = pai.id
        db_session.add(AccessGrant(group_id=cena["grupo"].id, workspace_id=pai.id, permission_key="colecao.ver"))
        db_session.commit()

        entradas = {e["name"]: e for e in self._painel(client, cena, "report", cena["r3"].id).json()["entries"]}

        assert entradas["Turma de dados"]["origins"] == [{"kind": "inherited", "label": "Herdado de Diretoria geral"}]

    def test_o_preset_grava_os_itens_e_o_painel_reconhece_de_volta(self, client, cena):
        for preset, esperado in (("ver", ["relatorio.ver"]), ("exportar", ["relatorio.exportar", "relatorio.ver"])):
            resposta = client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['ana_id']}", json={"preset": preset}, headers=cena["admin"])
            assert resposta.status_code == 200 and sorted(resposta.json()["permissions"]) == sorted(esperado) and resposta.json()["preset"] == preset

        gerenciar = client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['ana_id']}", json={"preset": "gerenciar"}, headers=cena["admin"]).json()
        assert gerenciar["preset"] == "gerenciar" and "relatorio.compartilhar" in gerenciar["permissions"]

    def test_vazio_remove_o_acesso_direto(self, client, db_session, cena):
        client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['ana_id']}", json={"preset": "ver"}, headers=cena["admin"])

        client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['ana_id']}", json={"permissions": []}, headers=cena["admin"])

        assert db_session.query(ReportGrant).count() == 0
        assert self._painel(client, cena, "report", cena["r1"].id).json()["entries"] == []

    def test_preset_desconhecido_e_item_que_nao_vale_sao_recusados(self, client, cena):
        assert client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['ana_id']}", json={"preset": "tudo"}, headers=cena["admin"]).status_code == 422
        assert client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['ana_id']}", json={"permissions": ["colecao.excluir"]}, headers=cena["admin"]).status_code == 422
        assert client.put(f"/access-panel/dataset/1/user/{cena['ana_id']}", json={"permissions": ["relatorio.ver"]}, headers=cena["admin"]).status_code in (404, 422)

    def test_so_quem_pode_gerenciar_abre_o_painel(self, client, cena):
        assert self._painel(client, cena, "report", cena["r1"].id, quem="caio").status_code == 403
        assert client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['beto_id']}", json={"preset": "ver"}, headers=cena["caio"]).status_code == 403

    def test_quem_compartilha_so_da_o_que_tem_e_so_naquele_item(self, client, cena):
        client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['ana_id']}", json={"permissions": ["relatorio.compartilhar"]}, headers=cena["admin"])

        permitido = client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['beto_id']}", json={"preset": "ver"}, headers=cena["ana"])
        negado = client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['beto_id']}", json={"preset": "exportar"}, headers=cena["ana"])
        outro = client.put(f"/access-panel/report/{cena['r2'].id}/user/{cena['beto_id']}", json={"preset": "ver"}, headers=cena["ana"])

        assert permitido.status_code == 200 and negado.status_code == 403 and outro.status_code == 403

    def test_ninguem_da_acesso_ao_administrador_da_plataforma(self, client, db_session, cena):
        admin_id = db_session.query(User).filter_by(email="admin@example.com").one().id
        admins = db_session.query(Group).filter(Group.is_admin_group.is_(True)).one()

        assert client.put(f"/access-panel/report/{cena['r1'].id}/user/{admin_id}", json={"preset": "ver"}, headers=cena["admin"]).status_code == 400
        assert client.put(f"/access-panel/report/{cena['r1'].id}/group/{admins.id}", json={"preset": "ver"}, headers=cena["admin"]).status_code == 400

    def test_item_que_nao_existe(self, client, cena):
        assert self._painel(client, cena, "report", 99999).status_code == 404
        assert self._painel(client, cena, "dataset", 99999).status_code == 404


class TestConvitePorEmail:
    def _convidar(self, client, cena, email, quem="admin", kind="report", item=None, preset="ver"):
        item = item or cena["r1"].id
        return client.post(f"/access-panel/{kind}/{item}/invite", json={"email": email, "preset": preset}, headers=cena[quem])

    def test_quem_ja_tem_conta_recebe_na_hora(self, client, db_session, cena):
        resposta = self._convidar(client, cena, "ana@example.com")

        assert resposta.json()["status"] == "applied"
        assert db_session.query(ReportGrant).filter_by(user_id=cena["ana_id"]).count() == 1

    def test_e_mail_sem_conta_cria_o_convite_e_reserva_o_acesso(self, client, db_session, cena):
        resposta = self._convidar(client, cena, "Nova.Pessoa@Example.com")

        assert resposta.json()["status"] == "pending"
        assert db_session.query(GroupInvite).filter_by(email="nova.pessoa@example.com").count() == 1  # e-mail normalizado
        assert db_session.query(ReportInviteGrant).filter_by(email="nova.pessoa@example.com").count() == 1

    def test_o_acesso_reservado_vale_quando_a_conta_e_criada(self, client, db_session, cena):
        self._convidar(client, cena, "nova@example.com")
        client.post("/auth/register", json={"name": "Nova", "email": "nova@example.com", "password": PASSWORD})
        token = client.post("/auth/login", json={"email": "nova@example.com", "password": PASSWORD}).json()["access_token"]
        nova = {"Authorization": f"Bearer {token}"}

        assert client.get("/catalog/workspaces", headers=nova).json()[0]["name"] == "Financeiro do tenant"
        assert db_session.query(ReportInviteGrant).count() == 0

    def test_quem_nao_adiciona_membros_nao_cria_convite_novo(self, client, db_session, cena):
        client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['ana_id']}", json={"permissions": ["relatorio.compartilhar"]}, headers=cena["admin"])

        resposta = self._convidar(client, cena, "desconhecida@example.com", quem="ana")

        assert resposta.status_code == 403 and db_session.query(GroupInvite).count() == 0

    def test_convite_de_modelo_tambem_reserva_e_aplica(self, client, db_session, cena):
        ds1 = _dataset(db_session, cena, "ds-1")
        self._convidar(client, cena, "modelo@example.com", kind="dataset", item=ds1.id)
        assert db_session.query(DatasetInviteGrant).count() == 1
        client.post("/auth/register", json={"name": "Modelo", "email": "modelo@example.com", "password": PASSWORD})

        usuario = db_session.query(User).filter_by(email="modelo@example.com").one()
        assert [g.permission_key for g in db_session.query(DatasetGrant).filter_by(user_id=usuario.id)] == ["modelo.ver"]
        assert db_session.query(DatasetInviteGrant).count() == 0

    def test_escolher_o_que_a_pessoa_pode_e_obrigatorio(self, client, cena):
        resposta = client.post(f"/access-panel/report/{cena['r1'].id}/invite", json={"email": "ana@example.com", "permissions": []}, headers=cena["admin"])

        assert resposta.status_code == 422


class TestAutocompletar:
    def test_acha_pessoas_e_grupos_pelo_nome_ou_pelo_email(self, client, cena):
        por_nome = client.get("/access-panel/subjects", params={"q": "tur"}, headers=cena["admin"]).json()
        por_email = client.get("/access-panel/subjects", params={"q": "ana@"}, headers=cena["admin"]).json()

        assert [(s["kind"], s["name"]) for s in por_nome] == [("group", "Turma de dados")]
        assert [(s["kind"], s["email"]) for s in por_email] == [("user", "ana@example.com")]

    def test_texto_vazio_nao_lista_ninguem_e_o_grupo_de_administradores_nao_aparece(self, client, cena):
        assert client.get("/access-panel/subjects", params={"q": ""}, headers=cena["admin"]).json() == []
        assert all(s["name"] != "Administradores" for s in client.get("/access-panel/subjects", params={"q": "adm"}, headers=cena["admin"]).json())

    def test_so_quem_pode_compartilhar_algo_busca(self, client, cena):
        assert client.get("/access-panel/subjects", params={"q": "a"}, headers=cena["caio"]).status_code == 403
        client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['caio_id']}", json={"permissions": ["relatorio.compartilhar"]}, headers=cena["admin"])
        assert client.get("/access-panel/subjects", params={"q": "ana"}, headers=cena["caio"]).status_code == 200

    def test_pessoa_bloqueada_nao_aparece(self, client, db_session, cena):
        db_session.query(User).filter_by(id=cena["beto_id"]).update({"is_blocked": True})
        db_session.commit()

        assert client.get("/access-panel/subjects", params={"q": "beto"}, headers=cena["admin"]).json() == []


class TestPermissoesDeModelo:
    def test_catalogo_do_escopo_modelo(self):
        assert access_catalog.DATASET_CAPABLE == {"modelo.ver", "modelo.atualizar", "modelo.historico", "modelo.seguranca", "modelo.compartilhar"}
        assert access_catalog.with_implied_dataset({"modelo.historico"}) == ["modelo.ver", "modelo.historico"]
        assert access_catalog.scope_of("modelo.ver") == "dataset" and access_catalog.scope_of("modelo.seguranca") == "global"

    def test_os_itens_so_de_modelo_nao_aparecem_no_catalogo_de_colecoes_e_globais(self, client, cena):
        chaves = {p["key"] for p in client.get("/access/catalog", headers=cena["admin"]).json()["permissions"]}

        assert not ({"modelo.ver", "modelo.atualizar", "modelo.historico", "modelo.compartilhar"} & chaves) and "modelo.seguranca" in chaves

    @pytest.mark.parametrize("chave", sorted(access_catalog.DATASET_CAPABLE))
    def test_um_item_dado_sozinho_vale_naquele_modelo_e_em_nenhum_outro(self, db_session, cena, chave):
        ds1, ds2 = _dataset(db_session, cena, "ds-1"), _dataset(db_session, cena, "ds-2")
        esperado = set(access_catalog.with_implied_dataset({chave}))
        for k in esperado:
            db_session.add(DatasetGrant(dataset_id=ds1.id, user_id=cena["ana_id"], permission_key=k))
        db_session.commit()

        acesso = effective_access(db_session, cena["ana_id"])

        assert acesso.dataset_keys(ds1.id) == esperado and acesso.dataset_keys(ds2.id) == set()
        assert acesso.by_workspace == {} and acesso.by_report == {} and acesso.global_keys == set()

    def test_as_permissoes_gerais_somam_com_as_do_modelo(self, db_session, cena):
        ds1, ds2 = _dataset(db_session, cena, "ds-1"), _dataset(db_session, cena, "ds-2")
        db_session.add(AccessGrant(user_id=cena["ana_id"], workspace_id=None, permission_key="modelo.seguranca"))
        db_session.add(DatasetGrant(dataset_id=ds1.id, user_id=cena["ana_id"], permission_key="modelo.atualizar"))
        db_session.add(DatasetGrant(dataset_id=ds1.id, user_id=cena["ana_id"], permission_key="modelo.ver"))
        db_session.commit()

        acesso = effective_access(db_session, cena["ana_id"])

        assert acesso.dataset_keys(ds1.id) == {"modelo.ver", "modelo.atualizar", "modelo.seguranca"}
        assert acesso.dataset_keys(ds2.id) == {"modelo.seguranca", "modelo.ver"}  # a geral vale em todos

    def test_atualizar_e_historico_exigem_o_item_no_modelo(self, client, db_session, cena):
        ds1 = _dataset(db_session, cena, "ds-1")
        refresh, history = MagicMock(), MagicMock(return_value=[{"status": "Completed", "refreshType": "Scheduled", "startTime": "2026-11-25T01:00:00Z", "endTime": "2026-11-25T01:02:00Z"}])
        with patch.object(powerbi_core, "refresh_dataset", refresh), patch.object(powerbi_core, "get_refresh_history", history):
            assert client.post(f"/catalog/datasets/{ds1.id}/refresh", headers=cena["ana"]).status_code == 403
            assert client.get(f"/catalog/datasets/{ds1.id}/history", headers=cena["ana"]).status_code == 403
            refresh.assert_not_called()

            client.put(f"/access-panel/dataset/{ds1.id}/user/{cena['ana_id']}", json={"permissions": ["modelo.atualizar"]}, headers=cena["admin"])
            assert client.post(f"/catalog/datasets/{ds1.id}/refresh", headers=cena["ana"]).status_code == 202
            assert client.get(f"/catalog/datasets/{ds1.id}/history", headers=cena["ana"]).status_code == 403  # nao recebeu o historico
            refresh.assert_called_once()

            client.put(f"/access-panel/dataset/{ds1.id}/user/{cena['ana_id']}", json={"permissions": ["modelo.historico"]}, headers=cena["admin"])
            lista = client.get(f"/catalog/datasets/{ds1.id}/history", headers=cena["ana"]).json()
            assert lista[0]["status"] == "Completed" and lista[0]["kind"] == "Scheduled"

    def test_a_seguranca_do_modelo_vale_quando_dada_so_naquele_modelo(self, client, db_session, cena):
        ds1, ds2 = _dataset(db_session, cena, "ds-1"), _dataset(db_session, cena, "ds-2")
        client.put(f"/access-panel/dataset/{ds1.id}/user/{cena['ana_id']}", json={"permissions": ["modelo.seguranca"]}, headers=cena["admin"])

        assert client.get(f"/catalog/datasets/{ds1.id}/security", headers=cena["ana"]).status_code == 200
        assert client.get(f"/catalog/datasets/{ds2.id}/security", headers=cena["ana"]).status_code == 403
        assert client.put(f"/catalog/datasets/{ds1.id}/security", json={"grants": [{"group_id": cena["grupo"].id, "pbi_role": "A"}]}, headers=cena["ana"]).status_code == 200

    def test_so_se_da_o_que_se_tem_no_modelo(self, client, db_session, cena):
        ds1 = _dataset(db_session, cena, "ds-1")
        client.put(f"/access-panel/dataset/{ds1.id}/user/{cena['ana_id']}", json={"permissions": ["modelo.compartilhar"]}, headers=cena["admin"])

        assert client.put(f"/access-panel/dataset/{ds1.id}/user/{cena['beto_id']}", json={"preset": "ver"}, headers=cena["ana"]).status_code == 200
        negado = client.put(f"/access-panel/dataset/{ds1.id}/user/{cena['beto_id']}", json={"preset": "atualizar"}, headers=cena["ana"])
        assert negado.status_code == 403 and "Faltam" in negado.json()["detail"]

    def test_tirar_o_ver_do_modelo_tira_o_resto(self, client, db_session, cena):
        ds1 = _dataset(db_session, cena, "ds-1")
        client.put(f"/access-panel/dataset/{ds1.id}/user/{cena['ana_id']}", json={"preset": "gerenciar"}, headers=cena["admin"])

        client.post("/access-panel/bulk", json={"items": [{"kind": "dataset", "id": ds1.id}], "user_ids": [cena["ana_id"]], "permissions": ["modelo.ver"], "mode": "remove"}, headers=cena["admin"])

        assert db_session.query(DatasetGrant).count() == 0

    def test_excluir_o_grupo_ou_a_pessoa_apaga_o_que_foi_dado_no_modelo(self, client, db_session, cena):
        ds1 = _dataset(db_session, cena, "ds-1")
        client.put(f"/access-panel/dataset/{ds1.id}/group/{cena['grupo'].id}", json={"preset": "ver"}, headers=cena["admin"])
        client.put(f"/access-panel/dataset/{ds1.id}/user/{cena['beto_id']}", json={"preset": "ver"}, headers=cena["admin"])

        assert client.delete(f"/groups/{cena['grupo'].id}", headers=cena["admin"]).status_code in (200, 204)
        assert db_session.query(DatasetGrant).count() == 1
        assert client.delete(f"/users/{cena['beto_id']}", headers=cena["admin"]).status_code in (200, 204)
        assert db_session.query(DatasetGrant).count() == 0

    def test_a_pessoa_recebe_no_access_me_o_que_tem_nos_modelos(self, client, db_session, cena):
        ds1 = _dataset(db_session, cena, "ds-1")
        client.put(f"/access-panel/dataset/{ds1.id}/user/{cena['ana_id']}", json={"preset": "atualizar"}, headers=cena["admin"])

        meu = client.get("/access/me", headers=cena["ana"]).json()

        assert meu["dataset_permissions"] == {str(ds1.id): ["modelo.atualizar", "modelo.historico", "modelo.ver"]}


class TestLotes:
    def test_compartilha_relatorios_e_modelos_de_uma_vez(self, client, db_session, cena):
        ds1 = _dataset(db_session, cena, "ds-1")
        corpo = {"items": [{"kind": "report", "id": cena["r1"].id}, {"kind": "report", "id": cena["r2"].id}, {"kind": "dataset", "id": ds1.id}], "group_ids": [cena["grupo"].id], "user_ids": [cena["ana_id"]], "preset": "ver"}

        resposta = client.post("/access-panel/bulk", json=corpo, headers=cena["admin"])

        assert resposta.json() == {"items": 3, "subjects": 2, "changes": 6}
        assert client.post("/access-panel/bulk", json=corpo, headers=cena["admin"]).json()["changes"] == 0

    def test_o_pedido_inteiro_entra_ou_nenhuma_parte_dele(self, client, db_session, cena):
        client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['ana_id']}", json={"permissions": ["relatorio.compartilhar"]}, headers=cena["admin"])
        corpo = {"items": [{"kind": "report", "id": cena["r1"].id}, {"kind": "report", "id": cena["r2"].id}], "user_ids": [cena["beto_id"]], "preset": "ver"}

        resposta = client.post("/access-panel/bulk", json=corpo, headers=cena["ana"])

        assert resposta.status_code == 403 and db_session.query(ReportGrant).filter_by(user_id=cena["beto_id"]).count() == 0

    def test_exige_alguem_e_o_que_dar(self, client, cena):
        item = [{"kind": "report", "id": cena["r1"].id}]
        assert client.post("/access-panel/bulk", json={"items": item, "preset": "ver"}, headers=cena["admin"]).status_code == 422
        assert client.post("/access-panel/bulk", json={"items": item, "user_ids": [cena["ana_id"]]}, headers=cena["admin"]).status_code == 422

    def test_poe_varios_relatorios_numa_pasta_sem_tirar_das_outras(self, client, db_session, cena):
        comercial = Workspace(name="Comercial", slug="comercial")
        db_session.add(comercial)
        db_session.commit()

        resposta = client.post("/access-panel/bulk-folders", json={"report_ids": [cena["r1"].id, cena["r2"].id, cena["r3"].id], "add": [comercial.id]}, headers=cena["admin"])

        assert resposta.json() == {"items": 3, "subjects": 1, "changes": 3}
        db_session.refresh(cena["r1"])
        db_session.refresh(cena["r3"])
        assert cena["r1"].collection_id == comercial.id  # estava na Raiz: publicado
        assert cena["r3"].collection_id == cena["financeiro"].id  # continua na dele
        assert [v.collection_id for v in db_session.query(ReportCollection).filter_by(report_id=cena["r3"].id)] == [comercial.id]

    def test_tira_de_uma_pasta_e_o_ultimo_vai_para_a_raiz(self, client, db_session, cena):
        resposta = client.post("/access-panel/bulk-folders", json={"report_ids": [cena["r3"].id], "remove": [cena["financeiro"].id]}, headers=cena["admin"])

        assert resposta.json()["changes"] == 1
        db_session.refresh(cena["r3"])
        assert cena["r3"].collection_id == cena["raiz"].id

    def test_pastas_em_lote_conferem_tudo_antes(self, client, db_session, cena):
        client.put(f"/access/users/{cena['ana_id']}", json={"blocks": [{"workspace_id": cena["financeiro"].id, "permissions": ["colecao.ver", "relatorio.editar", "relatorio.publicar"]}]}, headers=cena["admin"])
        comercial = Workspace(name="Comercial", slug="comercial")
        db_session.add(comercial)
        db_session.commit()

        resposta = client.post("/access-panel/bulk-folders", json={"report_ids": [cena["r3"].id, cena["r4"].id], "add": [comercial.id]}, headers=cena["ana"])

        assert resposta.status_code == 403  # ela edita o r3, mas nao o r4 (da Raiz) nem publica no Comercial
        assert db_session.query(ReportCollection).count() == 0

    def test_a_raiz_e_pasta_que_nao_existe_sao_recusadas(self, client, cena):
        assert client.post("/access-panel/bulk-folders", json={"report_ids": [cena["r1"].id], "add": [cena["raiz"].id]}, headers=cena["admin"]).status_code == 400
        assert client.post("/access-panel/bulk-folders", json={"report_ids": [cena["r1"].id], "add": [99999]}, headers=cena["admin"]).status_code == 400
        assert client.post("/access-panel/bulk-folders", json={"report_ids": [cena["r1"].id]}, headers=cena["admin"]).status_code == 422


class TestListasPorPessoaOuGrupo:
    def test_a_lista_do_que_uma_pessoa_recebeu_direto(self, client, db_session, cena):
        ds1 = _dataset(db_session, cena, "ds-1")
        client.put(f"/access-panel/report/{cena['r1'].id}/user/{cena['ana_id']}", json={"preset": "exportar"}, headers=cena["admin"])
        client.put(f"/access-panel/report/{cena['r2'].id}/user/{cena['ana_id']}", json={"preset": "ver"}, headers=cena["admin"])
        client.put(f"/access-panel/dataset/{ds1.id}/user/{cena['ana_id']}", json={"preset": "atualizar"}, headers=cena["admin"])

        relatorios = client.get(f"/access-panel/by-subject/user/{cena['ana_id']}", headers=cena["admin"]).json()
        modelos = client.get(f"/access-panel/by-subject/user/{cena['ana_id']}", params={"kind": "dataset"}, headers=cena["admin"]).json()

        assert [(i["name"], i["preset"], i["in_root"]) for i in relatorios["items"]] == [("Fluxo", "ver", True), ("Resultado", "exportar", True)]
        assert [(i["name"], i["preset"]) for i in modelos["items"]] == [(ds1.name, "atualizar")]

    def test_pagina_e_busca(self, client, cena):
        for chave in ("r1", "r2", "r3", "r4"):
            client.put(f"/access-panel/report/{cena[chave].id}/group/{cena['grupo'].id}", json={"preset": "ver"}, headers=cena["admin"])

        pagina = client.get(f"/access-panel/by-subject/group/{cena['grupo'].id}", params={"page_size": 3, "page": 2}, headers=cena["admin"]).json()
        achados = client.get(f"/access-panel/by-subject/group/{cena['grupo'].id}", params={"search": "vend"}, headers=cena["admin"]).json()

        assert pagina["total"] == 4 and len(pagina["items"]) == 1
        assert [i["name"] for i in achados["items"]] == ["Vendas"]

    def test_so_quem_ve_membros_ou_grupos_consulta(self, client, cena):
        assert client.get(f"/access-panel/by-subject/user/{cena['ana_id']}", headers=cena["caio"]).status_code == 403


class TestPainelDaPessoaSemLimite:
    def test_mostra_mais_de_dois_mil_relatorios_paginados(self, client, db_session, cena):
        colecao = Workspace(name="Grande", slug="grande")
        db_session.add(colecao)
        db_session.commit()
        db_session.bulk_save_objects([Report(collection_id=colecao.id, name=f"Rel {i:04d}", pbi_workspace_id="w", pbi_report_id=f"r{i}") for i in range(2100)])
        db_session.add(AccessGrant(user_id=cena["ana_id"], workspace_id=colecao.id, permission_key="colecao.ver"))
        db_session.commit()

        primeira = client.get(f"/report-access/person/{cena['ana_id']}", params={"page_size": 100}, headers=cena["admin"]).json()
        ultima = client.get(f"/report-access/person/{cena['ana_id']}", params={"page_size": 100, "page": 21}, headers=cena["admin"]).json()
        achados = client.get(f"/report-access/person/{cena['ana_id']}", params={"search": "Rel 2099"}, headers=cena["admin"]).json()

        assert primeira["total"] == 2100 and len(primeira["rows"]) == 100 and len(ultima["rows"]) == 100
        assert [r["report"]["name"] for r in achados["rows"]] == ["Rel 2099"] and achados["total"] == 1

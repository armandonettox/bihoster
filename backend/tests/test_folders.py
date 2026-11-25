"""Pastas e relatorio em varias pastas (fase 3). Dados ficticios; a API do Power BI nunca e chamada: um relatorio sem
conta responde 400 quando a pessoa passa e 403 quando nao passa."""

import pytest

from app.core import folder_tree
from app.core.access_engine import effective_access
from app.core.root_collection import ensure_root_collection
from app.models.access_grant import AccessGrant
from app.models.report import Report
from app.models.report_grant import ReportCollection, ReportGrant
from app.models.user import User
from app.models.workspace import Group, GroupMember, Workspace

PASSWORD = "SenhaForte123"


class TestArvorePura:
    def test_profundidade_e_altura(self):
        parents = {1: None, 2: 1, 3: 2, 4: None}

        assert folder_tree.depth_of(parents, 1) == 1 and folder_tree.depth_of(parents, 3) == 3
        assert folder_tree.height_of(parents, 1) == 3 and folder_tree.height_of(parents, 3) == 1

    def test_recusa_pasta_dentro_dela_mesma_ou_de_uma_descendente(self):
        parents = {1: None, 2: 1, 3: 2}

        assert folder_tree.validate_parent(parents, 1, 1) is not None
        assert folder_tree.validate_parent(parents, 1, 3) is not None
        assert folder_tree.validate_parent(parents, 3, 1) is None

    def test_recusa_pai_que_nao_existe_e_aceita_pasta_de_topo(self):
        assert folder_tree.validate_parent({1: None}, None, 99) is not None
        assert folder_tree.validate_parent({1: None}, 1, None) is None

    def test_limite_de_cinco_niveis_conta_o_que_a_pasta_ja_tem_para_baixo(self):
        cadeia = {1: None, 2: 1, 3: 2, 4: 3, 5: 4}
        assert folder_tree.validate_parent(cadeia, None, 4) is None  # a nova ficaria no nivel 5
        assert folder_tree.validate_parent(cadeia, None, 5) is not None  # ficaria no nivel 6
        com_filha = {**cadeia, 6: None, 7: 6}  # a pasta 6 tem uma filha: altura 2
        assert folder_tree.validate_parent(com_filha, 6, 3) is None  # 3 + 2 = 5
        assert folder_tree.validate_parent(com_filha, 6, 4) is not None  # 4 + 2 = 6

    def test_dado_sujo_com_ciclo_nao_trava(self):
        ciclo = {1: 2, 2: 1}

        assert folder_tree.ancestors(ciclo, 1) == [2]
        assert folder_tree.descendants(ciclo, 1) == {2}
        assert folder_tree.height_of(ciclo, 1) >= 1

    def test_heranca_de_pai_para_filha_e_neta_so_soma(self):
        parents = {1: None, 2: 1, 3: 2, 4: 1, 5: None}
        dadas = {1: {"colecao.ver"}, 3: {"relatorio.exportar"}, 5: {"colecao.editar"}}

        resultado = folder_tree.inherit_keys(dadas, parents)

        assert resultado[2] == {"colecao.ver"} and resultado[4] == {"colecao.ver"}  # filha e irma
        assert resultado[3] == {"colecao.ver", "relatorio.exportar"}  # neta: a heranca e o que tem de seu
        assert resultado[1] == {"colecao.ver"}  # o pai nao recebe do que e dado na filha
        assert resultado[5] == {"colecao.editar"}  # outra pasta de topo nao e tocada

    def test_sem_pastas_dentro_de_pastas_nada_muda(self):
        dadas = {1: {"colecao.ver"}}

        assert folder_tree.inherit_keys(dadas, {1: None, 2: None}) is dadas

    def test_caminho_so_para_quem_acessa_uma_subpasta(self):
        parents = {1: None, 2: 1, 3: 2, 4: 1}

        assert folder_tree.visible_with_path({3}, parents) == {3: True, 2: False, 1: False}


def _entrar(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def cena(client, db_session):
    """Financeiro > (Faturamento > Notas) e Financeiro > Custos; Comercial; tres pessoas; um relatorio em cada pasta."""
    admin = _entrar(client, "admin@example.com")
    ana = _entrar(client, "ana@example.com")
    beto = _entrar(client, "beto@example.com")
    caio = _entrar(client, "caio@example.com")
    ids = {u.email: u.id for u in db_session.query(User).all()}

    def pasta(nome, pai=None):
        resposta = client.post("/workspaces/", json={"name": nome, "everyone_can_view": False, "parent_id": pai}, headers=admin)
        assert resposta.status_code == 201, resposta.text
        return resposta.json()["id"]

    financeiro = pasta("Financeiro")
    faturamento = pasta("Faturamento", financeiro)
    notas = pasta("Notas", faturamento)
    custos = pasta("Custos", financeiro)
    comercial = pasta("Comercial")

    def relatorio(colecao, nome):
        r = Report(collection_id=colecao, name=nome, pbi_workspace_id="ws", pbi_report_id=f"rep-{nome}")
        db_session.add(r)
        db_session.commit()
        return r

    return {
        "admin": admin, "ana": ana, "beto": beto, "caio": caio,
        "ana_id": ids["ana@example.com"], "beto_id": ids["beto@example.com"], "caio_id": ids["caio@example.com"],
        "financeiro": financeiro, "faturamento": faturamento, "notas": notas, "custos": custos, "comercial": comercial,
        "r_fin": relatorio(financeiro, "RFin"), "r_fat": relatorio(faturamento, "RFat"), "r_notas": relatorio(notas, "RNotas"),
        "r_custos": relatorio(custos, "RCustos"), "r_com": relatorio(comercial, "RCom"),
        "raiz": ensure_root_collection(db_session),
    }


def _dar(client, cena, quem, pasta, permissoes):
    resposta = client.put(
        f"/access/users/{cena[quem + '_id']}",
        json={"blocks": [{"workspace_id": pasta, "permissions": permissoes}]},
        headers=cena["admin"],
    )
    assert resposta.status_code == 200, resposta.text


def _dar_varias(client, cena, quem, por_pasta):
    """Troca TUDO o que a pessoa tem pelas permissoes dadas (a rota substitui o conjunto inteiro)."""
    blocos = [{"workspace_id": pasta, "permissions": permissoes} for pasta, permissoes in por_pasta.items()]
    resposta = client.put(f"/access/users/{cena[quem + '_id']}", json={"blocks": blocos}, headers=cena["admin"])
    assert resposta.status_code == 200, resposta.text


def _embed(client, cena, relatorio, quem, pasta=None):
    return client.get(f"/workspaces/{pasta or relatorio.collection_id}/powerbi/reports/{relatorio.id}/embed", headers=cena[quem]).status_code


class TestCriarEMover:
    def test_a_pasta_nasce_dentro_da_outra_e_a_lista_diz_o_pai(self, client, cena):
        lista = {w["name"]: w["parent_id"] for w in client.get("/workspaces/all", headers=cena["admin"]).json()}

        assert lista == {"Financeiro": None, "Faturamento": cena["financeiro"], "Notas": cena["faturamento"], "Custos": cena["financeiro"], "Comercial": None}

    def test_criar_subpasta_exige_o_item_na_pasta_de_cima_e_nao_so_o_de_criar_colecoes(self, client, cena):
        client.put(f"/access/users/{cena['ana_id']}", json={"blocks": [{"workspace_id": None, "permissions": ["colecao.criar"]}]}, headers=cena["admin"])

        negado = client.post("/workspaces/", json={"name": "Nova", "parent_id": cena["financeiro"]}, headers=cena["ana"])
        topo = client.post("/workspaces/", json={"name": "Topo"}, headers=cena["ana"])

        assert negado.status_code == 403 and topo.status_code == 201

    def test_com_o_item_na_pasta_cria_ai_e_nas_de_dentro_pela_heranca(self, client, cena):
        _dar(client, cena, "beto", cena["financeiro"], ["colecao.ver", "colecao.criar-subpasta"])

        nova = client.post("/workspaces/", json={"name": "Nova", "parent_id": cena["faturamento"]}, headers=cena["beto"])

        assert nova.status_code == 201 and nova.json()["parent_id"] == cena["faturamento"]

    def test_nao_cria_dentro_da_raiz_nem_passa_de_cinco_niveis_nem_dentro_de_pasta_inexistente(self, client, cena):
        assert client.post("/workspaces/", json={"name": "X", "parent_id": cena["raiz"].id}, headers=cena["admin"]).status_code == 400
        assert client.post("/workspaces/", json={"name": "X", "parent_id": 99999}, headers=cena["admin"]).status_code == 400
        n4 = client.post("/workspaces/", json={"name": "N4", "parent_id": cena["notas"]}, headers=cena["admin"]).json()["id"]
        n5 = client.post("/workspaces/", json={"name": "N5", "parent_id": n4}, headers=cena["admin"]).json()["id"]
        assert client.post("/workspaces/", json={"name": "N6", "parent_id": n5}, headers=cena["admin"]).status_code == 400

    def test_mover_para_dentro_de_uma_descendente_e_recusado(self, client, cena):
        resposta = client.put(f"/workspaces/{cena['financeiro']}", json={"parent_id": cena["notas"]}, headers=cena["admin"])

        assert resposta.status_code == 400

    def test_mover_uma_pasta_leva_as_de_dentro(self, client, cena):
        resposta = client.put(f"/workspaces/{cena['faturamento']}", json={"parent_id": cena["comercial"]}, headers=cena["admin"])

        assert resposta.status_code == 200 and resposta.json()["parent_id"] == cena["comercial"]
        pais = {w["name"]: w["parent_id"] for w in client.get("/workspaces/all", headers=cena["admin"]).json()}
        assert pais["Notas"] == cena["faturamento"]

    def test_editar_sem_mandar_a_pasta_nao_mexe_nela(self, client, cena):
        resposta = client.put(f"/workspaces/{cena['faturamento']}", json={"name": "Faturamento 2"}, headers=cena["admin"])

        assert resposta.status_code == 200 and resposta.json()["parent_id"] == cena["financeiro"]

    def test_virar_pasta_de_topo_com_null(self, client, cena):
        resposta = client.put(f"/workspaces/{cena['faturamento']}", json={"parent_id": None}, headers=cena["admin"])

        assert resposta.json()["parent_id"] is None

    def test_mover_exige_poder_criar_subpastas_no_destino(self, client, cena):
        _dar(client, cena, "ana", cena["faturamento"], ["colecao.ver", "colecao.editar"])

        negado = client.put(f"/workspaces/{cena['faturamento']}", json={"parent_id": cena["comercial"]}, headers=cena["ana"])
        _dar_varias(client, cena, "ana", {cena["faturamento"]: ["colecao.ver", "colecao.editar"], cena["comercial"]: ["colecao.ver", "colecao.criar-subpasta"]})
        permitido = client.put(f"/workspaces/{cena['faturamento']}", json={"parent_id": cena["comercial"]}, headers=cena["ana"])

        assert negado.status_code == 403 and permitido.status_code == 200


class TestHeranca:
    def test_quem_ve_a_pasta_ve_as_de_dentro_e_os_relatorios_delas(self, client, cena):
        _dar(client, cena, "ana", cena["financeiro"], ["colecao.ver"])

        for relatorio in ("r_fin", "r_fat", "r_notas", "r_custos"):
            assert _embed(client, cena, cena[relatorio], "ana") != 403, relatorio
        assert _embed(client, cena, cena["r_com"], "ana") == 403
        nomes = {w["name"] for w in client.get("/workspaces/", headers=cena["ana"]).json()}
        assert nomes == {"Financeiro", "Faturamento", "Notas", "Custos"}

    def test_quem_ve_so_uma_subpasta_nao_ve_a_de_cima_nem_a_irma(self, client, cena):
        _dar(client, cena, "beto", cena["faturamento"], ["colecao.ver"])

        assert _embed(client, cena, cena["r_fat"], "beto") != 403
        assert _embed(client, cena, cena["r_notas"], "beto") != 403  # a de dentro herda
        assert _embed(client, cena, cena["r_fin"], "beto") == 403
        assert _embed(client, cena, cena["r_custos"], "beto") == 403
        assert client.get(f"/workspaces/{cena['financeiro']}", headers=cena["beto"]).status_code == 403
        assert client.get(f"/workspaces/{cena['financeiro']}/reports/", headers=cena["beto"]).status_code == 403

    def test_a_pasta_de_cima_aparece_so_como_caminho_com_o_nome(self, client, cena):
        _dar(client, cena, "beto", cena["faturamento"], ["colecao.ver"])

        arvore = {n["name"]: n for n in client.get("/workspaces/tree", headers=cena["beto"]).json()}

        assert set(arvore) == {"Financeiro", "Faturamento", "Notas"}
        assert arvore["Financeiro"]["accessible"] is False and arvore["Faturamento"]["accessible"] is True
        assert arvore["Notas"]["accessible"] is True
        assert "Custos" not in arvore and "Comercial" not in arvore
        assert {w["name"] for w in client.get("/workspaces/", headers=cena["beto"]).json()} == {"Faturamento", "Notas"}

    def test_a_arvore_de_quem_nao_tem_nada_vem_vazia_e_a_do_admin_tem_tudo_menos_a_raiz(self, client, cena):
        assert client.get("/workspaces/tree", headers=cena["caio"]).json() == []
        nomes = {n["name"] for n in client.get("/workspaces/tree", headers=cena["admin"]).json()}
        assert nomes == {"Financeiro", "Faturamento", "Notas", "Custos", "Comercial"}

    def test_a_subpasta_pode_ter_permissao_extra_sem_mudar_a_do_pai(self, db_session, cena):
        db_session.add(AccessGrant(user_id=cena["ana_id"], workspace_id=cena["financeiro"], permission_key="colecao.ver"))
        db_session.add(AccessGrant(user_id=cena["ana_id"], workspace_id=cena["faturamento"], permission_key="relatorio.exportar"))
        db_session.commit()

        acesso = effective_access(db_session, cena["ana_id"])

        assert "relatorio.exportar" in acesso.by_workspace[cena["faturamento"]] and "relatorio.exportar" in acesso.by_workspace[cena["notas"]]
        assert "relatorio.exportar" not in acesso.by_workspace[cena["financeiro"]]
        assert "relatorio.exportar" not in acesso.by_workspace[cena["custos"]]

    def test_pai_filha_e_neta_cada_uma_com_o_que_tem(self, db_session, cena):
        db_session.add(AccessGrant(user_id=cena["ana_id"], workspace_id=cena["financeiro"], permission_key="colecao.ver"))
        db_session.add(AccessGrant(user_id=cena["ana_id"], workspace_id=cena["faturamento"], permission_key="alerta.ver"))
        db_session.add(AccessGrant(user_id=cena["ana_id"], workspace_id=cena["notas"], permission_key="relatorio.exportar"))
        db_session.commit()

        acesso = effective_access(db_session, cena["ana_id"]).by_workspace

        assert acesso[cena["financeiro"]] == {"colecao.ver"}
        assert acesso[cena["faturamento"]] == {"colecao.ver", "alerta.ver"}
        assert acesso[cena["notas"]] == {"colecao.ver", "alerta.ver", "relatorio.exportar"}

    def test_o_grupo_tambem_passa_para_as_pastas_de_dentro(self, client, db_session, cena):
        grupo = Group(name="Dados")
        db_session.add(grupo)
        db_session.commit()
        db_session.add(GroupMember(group_id=grupo.id, user_id=cena["caio_id"]))
        db_session.add(AccessGrant(group_id=grupo.id, workspace_id=cena["financeiro"], permission_key="colecao.ver"))
        db_session.commit()

        assert _embed(client, cena, cena["r_notas"], "caio") != 403

    def test_aviso_de_impacto_conta_as_pastas_de_dentro(self, client, cena):
        dados = client.get(f"/report-access/impact/collections/{cena['financeiro']}", headers=cena["admin"]).json()

        assert dados["reports"] == 4  # RFin, RFat, RNotas e RCustos


class TestRelatorioEmVariasPastas:
    def _publicar(self, client, cena, relatorio, pastas, como="admin"):
        return client.put(f"/workspaces/{relatorio.collection_id}/reports/{relatorio.id}/folders", json={"collection_ids": pastas}, headers=cena[como])

    def test_o_mesmo_relatorio_aparece_em_duas_pastas_sem_cadastrar_de_novo(self, client, db_session, cena):
        resposta = self._publicar(client, cena, cena["r_com"], [cena["comercial"], cena["custos"]])

        assert resposta.status_code == 200 and resposta.json()["collection_ids"] == [cena["comercial"], cena["custos"]]
        nomes = [r["name"] for r in client.get(f"/workspaces/{cena['custos']}/reports/", headers=cena["admin"]).json()]
        assert nomes == ["RCustos", "RCom"]
        assert db_session.query(Report).filter_by(name="RCom").count() == 1

    def test_com_a_mesma_permissao_nas_duas_pastas_quem_ve_uma_ou_a_outra_abre(self, client, cena):
        self._publicar(client, cena, cena["r_com"], [cena["comercial"], cena["custos"]])
        _dar(client, cena, "ana", cena["comercial"], ["colecao.ver"])
        _dar(client, cena, "beto", cena["custos"], ["colecao.ver"])

        for quem in ("ana", "beto"):
            assert _embed(client, cena, cena["r_com"], quem) != 403, quem  # pelo caminho da colecao dele
        assert _embed(client, cena, cena["r_com"], "beto", pasta=cena["custos"]) != 403  # e pelo da pasta em que aparece
        assert _embed(client, cena, cena["r_com"], "caio") == 403

    def test_quem_ve_so_a_pasta_nova_nao_ve_os_outros_relatorios_da_colecao_do_relatorio(self, client, db_session, cena):
        extra = Report(collection_id=cena["comercial"], name="RCom2", pbi_workspace_id="ws", pbi_report_id="rep-RCom2")
        db_session.add(extra)
        db_session.commit()
        self._publicar(client, cena, cena["r_com"], [cena["comercial"], cena["custos"]])
        _dar(client, cena, "beto", cena["custos"], ["colecao.ver"])

        assert _embed(client, cena, cena["r_com"], "beto") != 403
        assert _embed(client, cena, extra, "beto") == 403

    def test_a_lista_da_pasta_nova_mostra_o_relatorio_com_a_colecao_de_verdade_para_o_endereco(self, client, cena):
        self._publicar(client, cena, cena["r_com"], [cena["comercial"], cena["custos"]])
        _dar(client, cena, "beto", cena["custos"], ["colecao.ver"])

        itens = client.get(f"/workspaces/{cena['custos']}/reports/", headers=cena["beto"]).json()

        assert [(r["name"], r["collection_id"]) for r in itens] == [("RCustos", cena["custos"]), ("RCom", cena["comercial"])]

    def test_a_busca_acha_o_relatorio_pela_pasta_em_que_a_pessoa_o_ve(self, client, cena):
        self._publicar(client, cena, cena["r_com"], [cena["custos"]])  # sai da Comercial e vai para a Custos
        _dar(client, cena, "beto", cena["custos"], ["colecao.ver"])

        itens = client.get("/search/", params={"q": "RCom"}, headers=cena["beto"]).json()

        assert [(i["name"], i["workspace_id"]) for i in itens if i["kind"] == "relatorio"] == [("RCom", cena["custos"])]

    def test_quem_nao_ve_a_pasta_nao_acha_o_relatorio_na_busca(self, client, cena):
        self._publicar(client, cena, cena["r_com"], [cena["comercial"], cena["custos"]])

        assert [i for i in client.get("/search/", params={"q": "RCom"}, headers=cena["caio"]).json()] == []

    def test_publicar_um_relatorio_da_raiz_o_leva_para_a_pasta(self, client, db_session, cena):
        na_raiz = Report(collection_id=cena["raiz"].id, name="Importado", pbi_workspace_id="ws", pbi_report_id="rep-imp")
        db_session.add(na_raiz)
        db_session.commit()
        _dar(client, cena, "beto", cena["comercial"], ["colecao.ver"])
        assert _embed(client, cena, na_raiz, "beto") == 403

        resposta = client.put(f"/workspaces/{cena['raiz'].id}/reports/{na_raiz.id}/folders", json={"collection_ids": [cena["comercial"]]}, headers=cena["admin"])

        assert resposta.status_code == 200 and resposta.json()["in_root"] is False
        db_session.refresh(na_raiz)
        assert na_raiz.collection_id == cena["comercial"]
        assert _embed(client, cena, na_raiz, "beto") != 403

    def test_tirar_de_todas_as_pastas_devolve_para_a_raiz_sem_apagar(self, client, db_session, cena):
        resposta = self._publicar(client, cena, cena["r_com"], [])

        assert resposta.json() == {"collection_ids": [], "in_root": True}
        db_session.refresh(cena["r_com"])
        assert cena["r_com"].collection_id == cena["raiz"].id

    def test_mudar_so_a_lista_mantem_a_colecao_do_relatorio_quando_ela_continua_nela(self, client, db_session, cena):
        self._publicar(client, cena, cena["r_com"], [cena["comercial"], cena["custos"], cena["notas"]])
        self._publicar(client, cena, cena["r_com"], [cena["custos"], cena["comercial"]])

        db_session.refresh(cena["r_com"])
        assert cena["r_com"].collection_id == cena["comercial"]
        vinculos = sorted(v.collection_id for v in db_session.query(ReportCollection).filter_by(report_id=cena["r_com"].id))
        assert vinculos == [cena["custos"]]

    def test_se_a_colecao_sai_da_lista_a_primeira_restante_vira_a_colecao(self, client, db_session, cena):
        self._publicar(client, cena, cena["r_com"], [cena["custos"], cena["notas"]])

        db_session.refresh(cena["r_com"])
        assert cena["r_com"].collection_id == cena["custos"]
        assert [v.collection_id for v in db_session.query(ReportCollection).filter_by(report_id=cena["r_com"].id)] == [cena["notas"]]

    def test_pastas_invalidas_sao_recusadas(self, client, cena):
        assert self._publicar(client, cena, cena["r_com"], [99999]).status_code == 400
        assert self._publicar(client, cena, cena["r_com"], [cena["raiz"].id]).status_code == 400

    def test_so_muda_quem_pode_editar_o_relatorio_e_publicar_nas_pastas_envolvidas(self, client, cena):
        _dar(client, cena, "ana", cena["comercial"], ["colecao.ver", "relatorio.editar"])

        sem_publicar = self._publicar(client, cena, cena["r_com"], [cena["comercial"], cena["custos"]], como="ana")
        _dar(client, cena, "ana", cena["comercial"], ["colecao.ver", "relatorio.editar", "relatorio.publicar"])
        sem_publicar_la = self._publicar(client, cena, cena["r_com"], [cena["comercial"], cena["custos"]], como="ana")
        _dar_varias(client, cena, "ana", {cena["comercial"]: ["colecao.ver", "relatorio.editar", "relatorio.publicar"], cena["custos"]: ["relatorio.publicar"]})
        completo = self._publicar(client, cena, cena["r_com"], [cena["comercial"], cena["custos"]], como="ana")

        assert sem_publicar.status_code == 403 and sem_publicar_la.status_code == 403 and completo.status_code == 200
        assert self._publicar(client, cena, cena["r_com"], [cena["comercial"]], como="caio").status_code == 403

    def test_excluir_pelo_caminho_de_uma_pasta_onde_so_aparece_tira_so_de_la(self, client, db_session, cena):
        self._publicar(client, cena, cena["r_com"], [cena["comercial"], cena["custos"]])

        resposta = client.delete(f"/workspaces/{cena['custos']}/reports/{cena['r_com'].id}", headers=cena["admin"])

        assert resposta.status_code == 204
        assert db_session.query(Report).filter_by(id=cena["r_com"].id).count() == 1
        assert db_session.query(ReportCollection).count() == 0

    def test_excluir_o_relatorio_apaga_os_vinculos(self, client, db_session, cena):
        self._publicar(client, cena, cena["r_com"], [cena["comercial"], cena["custos"]])

        client.delete(f"/workspaces/{cena['comercial']}/reports/{cena['r_com'].id}", headers=cena["admin"])

        assert db_session.query(Report).filter_by(name="RCom").count() == 0 and db_session.query(ReportCollection).count() == 0

    def test_as_pastas_do_relatorio_podem_ser_lidas_por_quem_o_ve(self, client, cena):
        self._publicar(client, cena, cena["r_com"], [cena["comercial"], cena["custos"]])
        _dar(client, cena, "ana", cena["comercial"], ["colecao.ver"])

        resposta = client.get(f"/workspaces/{cena['comercial']}/reports/{cena['r_com'].id}/folders", headers=cena["ana"])

        assert resposta.json() == {"collection_ids": [cena["comercial"], cena["custos"]], "in_root": False}
        assert client.get(f"/workspaces/{cena['comercial']}/reports/{cena['r_com'].id}/folders", headers=cena["caio"]).status_code == 403


class TestExcluirPasta:
    def test_nunca_apaga_relatorio_e_o_que_era_dela_volta_para_a_raiz(self, client, db_session, cena):
        resposta = client.delete(f"/workspaces/{cena['comercial']}", headers=cena["admin"])

        assert resposta.status_code == 204
        db_session.refresh(cena["r_com"])
        assert cena["r_com"].collection_id == cena["raiz"].id
        assert db_session.query(Workspace).filter_by(id=cena["comercial"]).count() == 0

    def test_o_relatorio_que_ja_aparecia_em_outra_pasta_fica_nela(self, client, db_session, cena):
        client.put(f"/workspaces/{cena['comercial']}/reports/{cena['r_com'].id}/folders", json={"collection_ids": [cena["comercial"], cena["custos"]]}, headers=cena["admin"])

        client.delete(f"/workspaces/{cena['comercial']}", headers=cena["admin"])

        db_session.refresh(cena["r_com"])
        assert cena["r_com"].collection_id == cena["custos"]
        assert db_session.query(ReportCollection).count() == 0

    def test_o_relatorio_que_aparecia_na_pasta_excluida_so_perde_o_vinculo(self, client, db_session, cena):
        client.put(f"/workspaces/{cena['comercial']}/reports/{cena['r_com'].id}/folders", json={"collection_ids": [cena["comercial"], cena["custos"]]}, headers=cena["admin"])

        client.delete(f"/workspaces/{cena['custos']}", headers=cena["admin"])

        db_session.refresh(cena["r_com"])
        assert cena["r_com"].collection_id == cena["comercial"] and db_session.query(ReportCollection).count() == 0

    def test_pasta_com_subpastas_exige_mover_ou_excluir_as_filhas_primeiro(self, client, db_session, cena):
        resposta = client.delete(f"/workspaces/{cena['financeiro']}", headers=cena["admin"])

        assert resposta.status_code == 409
        assert db_session.query(Workspace).filter_by(id=cena["financeiro"]).count() == 1
        assert db_session.query(Report).count() == 5

    def test_excluir_de_baixo_para_cima_nao_perde_nenhum_relatorio(self, client, db_session, cena):
        for pasta in ("notas", "faturamento", "custos", "financeiro"):
            assert client.delete(f"/workspaces/{cena[pasta]}", headers=cena["admin"]).status_code == 204

        assert db_session.query(Report).count() == 5
        assert {r.collection_id for r in db_session.query(Report).filter(Report.name != "RCom")} == {cena["raiz"].id}

    def test_as_permissoes_dadas_direto_no_relatorio_sobrevivem_a_exclusao_da_pasta(self, client, db_session, cena):
        client.put(f"/report-access/{cena['r_com'].id}/users/{cena['ana_id']}", json={"permissions": ["relatorio.ver"]}, headers=cena["admin"])

        client.delete(f"/workspaces/{cena['comercial']}", headers=cena["admin"])

        assert db_session.query(ReportGrant).count() == 1
        assert _embed(client, cena, cena["r_com"], "ana", pasta=cena["raiz"].id) != 403


class TestAcessosPorRelatorioComPastas:
    def test_a_matriz_mostra_o_que_o_grupo_recebe_pela_pasta_de_cima(self, client, db_session, cena):
        grupo = Group(name="Dados")
        db_session.add(grupo)
        db_session.commit()
        db_session.add(AccessGrant(group_id=grupo.id, workspace_id=cena["financeiro"], permission_key="colecao.ver"))
        db_session.commit()

        dados = client.get("/report-access/matrix", params={"search": "RNotas"}, headers=cena["admin"]).json()

        celula = dados["rows"][0]["cells"][str(grupo.id)]
        assert celula == {"direct": [], "inherited": ["relatorio.ver"]}

    def test_o_painel_da_pessoa_conta_o_relatorio_visto_por_outra_pasta(self, client, cena):
        client.put(f"/workspaces/{cena['comercial']}/reports/{cena['r_com'].id}/folders", json={"collection_ids": [cena["comercial"], cena["custos"]]}, headers=cena["admin"])
        _dar(client, cena, "beto", cena["custos"], ["colecao.ver"])

        dados = client.get(f"/report-access/person/{cena['beto_id']}", headers=cena["admin"]).json()

        origens = {linha["report"]["name"]: linha["sources"] for linha in dados["rows"]}
        assert origens["RCom"] == ["Coleção Custos"] and origens["RCustos"] == ["Coleção Custos"]

    def test_compartilhados_nao_repete_o_que_a_pessoa_ja_ve_por_uma_pasta(self, client, cena):
        client.put(f"/workspaces/{cena['comercial']}/reports/{cena['r_com'].id}/folders", json={"collection_ids": [cena["comercial"], cena["custos"]]}, headers=cena["admin"])
        client.put(f"/report-access/{cena['r_com'].id}/users/{cena['beto_id']}", json={"permissions": ["relatorio.ver"]}, headers=cena["admin"])
        _dar(client, cena, "beto", cena["custos"], ["colecao.ver"])

        assert client.get("/report-access/shared-with-me", headers=cena["beto"]).json() == []


class TestEnviosAgendadosAoDespublicar:
    """O relatorio que volta para a Raiz deixou de estar publicado: assinaturas e alertas dele sao encerrados."""

    def _assinatura_e_alerta(self, db_session, relatorio, user_id):
        from app.models.alert import ReportAlert
        from app.models.subscription import ReportSubscription

        db_session.add(ReportSubscription(report_id=relatorio.id, created_by_id=user_id, name="Semanal", fmt="PDF", recipients_json='["a@example.com"]', days_json="[1]", times_json='["08:00"]'))
        db_session.add(ReportAlert(report_id=relatorio.id, created_by_id=user_id, measure_name="Vendas", condition=">", threshold=1))
        db_session.commit()

    def _contar(self, db_session):
        from app.models.alert import ReportAlert
        from app.models.subscription import ReportSubscription

        return db_session.query(ReportSubscription).count(), db_session.query(ReportAlert).count()

    def test_excluir_a_pasta_encerra_os_envios_do_relatorio_que_vai_para_a_raiz(self, client, db_session, cena):
        self._assinatura_e_alerta(db_session, cena["r_com"], cena["ana_id"])

        client.delete(f"/workspaces/{cena['comercial']}", headers=cena["admin"])

        assert self._contar(db_session) == (0, 0)
        assert db_session.query(Report).filter_by(name="RCom").count() == 1

    def test_se_o_relatorio_continua_publicado_em_outra_pasta_os_envios_ficam(self, client, db_session, cena):
        client.put(f"/workspaces/{cena['comercial']}/reports/{cena['r_com'].id}/folders", json={"collection_ids": [cena["comercial"], cena["custos"]]}, headers=cena["admin"])
        self._assinatura_e_alerta(db_session, cena["r_com"], cena["ana_id"])

        client.delete(f"/workspaces/{cena['comercial']}", headers=cena["admin"])

        assert self._contar(db_session) == (1, 1)

    def test_tirar_o_relatorio_de_todas_as_pastas_tambem_encerra_os_envios(self, client, db_session, cena):
        self._assinatura_e_alerta(db_session, cena["r_com"], cena["ana_id"])

        client.put(f"/workspaces/{cena['comercial']}/reports/{cena['r_com'].id}/folders", json={"collection_ids": []}, headers=cena["admin"])

        assert self._contar(db_session) == (0, 0)

    def test_mudar_de_pasta_sem_despublicar_mantem_os_envios(self, client, db_session, cena):
        self._assinatura_e_alerta(db_session, cena["r_com"], cena["ana_id"])

        client.put(f"/workspaces/{cena['comercial']}/reports/{cena['r_com'].id}/folders", json={"collection_ids": [cena["custos"]]}, headers=cena["admin"])

        assert self._contar(db_session) == (1, 1)

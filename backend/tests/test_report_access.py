"""Permissao por relatorio (fase 2). Todos os dados sao ficticios e a API do Power BI nunca e chamada: os relatorios nao
tem conta configurada, entao uma rota que deixa a pessoa passar responde 400 ("sem conta"), e uma que a barra, 403."""

import pytest

from app.core import access_catalog
from app.core.access_engine import effective_access
from app.core.report_access import apply_pending_report_grants
from app.core.root_collection import ensure_root_collection
from app.models.report import Report
from app.models.report_grant import ReportGrant, ReportInviteGrant
from app.models.user import User
from app.models.workspace import Group, GroupMember, Workspace

PASSWORD = "SenhaForte123"


def _entrar(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def cena(client, db_session, make_workspace):
    """Uma colecao com dois relatorios (A e B), uma colecao com um (C), a Raiz com um (R), um grupo e tres pessoas."""
    admin = _entrar(client, "admin@example.com")
    ana = _entrar(client, "ana@example.com")
    beto = _entrar(client, "beto@example.com")
    caio = _entrar(client, "caio@example.com")
    ids = {u.email: u.id for u in db_session.query(User).all()}

    def relatorio(colecao, nome):
        r = Report(collection_id=colecao.id, name=nome, pbi_workspace_id="ws", pbi_report_id=f"rep-{nome}")
        db_session.add(r)
        db_session.commit()
        return r

    financeiro = make_workspace("Financeiro")
    comercial = make_workspace("Comercial")
    raiz = ensure_root_collection(db_session)
    grupo = Group(name="Turma de dados")
    db_session.add(grupo)
    db_session.commit()
    return {
        "admin": admin, "ana": ana, "beto": beto, "caio": caio,
        "ana_id": ids["ana@example.com"], "beto_id": ids["beto@example.com"], "caio_id": ids["caio@example.com"],
        "a": relatorio(financeiro, "A"), "b": relatorio(financeiro, "B"), "c": relatorio(comercial, "C"), "r": relatorio(raiz, "R"),
        "financeiro": financeiro, "comercial": comercial, "raiz": raiz, "grupo": grupo,
    }


def _dar(client, cena, report, quem, permissoes, *, como="admin"):
    caminho = f"/report-access/{report.id}/users/{cena[quem + '_id']}"
    return client.put(caminho, json={"permissions": permissoes}, headers=cena[como])


def _embed(client, cena, report, quem):
    return client.get(f"/workspaces/{report.collection_id}/powerbi/reports/{report.id}/embed", headers=cena[quem]).status_code


class TestCatalogoPorRelatorio:
    def test_so_o_que_se_faz_com_um_relatorio_existente_vale_num_relatorio(self):
        capazes = access_catalog.REPORT_CAPABLE
        assert {"relatorio.ver", "relatorio.compartilhar", "relatorio.exportar", "relatorio.editar", "relatorio.excluir", "assinatura.criar", "alerta.criar", "powerbi.atualizar"} <= capazes
        for fora in ("relatorio.publicar", "relatorio.reordenar", "colecao.ver", "colecao.editar", "colecao.excluir", "assinatura.todas", "alerta.todas", "membros.ver"):
            assert fora not in capazes

    def test_exportar_exige_ver_o_relatorio_e_nao_a_colecao(self):
        assert access_catalog.with_implied_report({"relatorio.exportar"}) == ["relatorio.exportar", "relatorio.ver"]
        assert "colecao.ver" not in access_catalog.with_implied_report({"assinatura.criar"})

    def test_o_catalogo_de_colecoes_e_globais_nao_mostra_os_itens_so_de_relatorio(self, client, cena):
        itens = {p["key"]: p for p in client.get("/access/catalog", headers=cena["admin"]).json()["permissions"]}

        assert "relatorio.ver" not in itens and "relatorio.compartilhar" not in itens
        assert itens["relatorio.exportar"]["scope"] == "workspace"

    def test_catalogo_do_relatorio_lista_os_itens_com_o_que_cada_um_exige(self, client, cena):
        itens = {p["key"]: p for p in client.get("/report-access/catalog", headers=cena["ana"]).json()["permissions"]}

        assert itens["relatorio.exportar"]["requires"] == ["relatorio.ver"]
        assert "relatorio.publicar" not in itens


class TestQuemTemSoUmRelatorio:
    def test_abre_o_relatorio_dado_e_nenhum_outro_da_mesma_colecao(self, client, cena):
        assert _dar(client, cena, cena["a"], "ana", ["relatorio.ver"]).status_code == 200

        assert _embed(client, cena, cena["a"], "ana") != 403
        assert _embed(client, cena, cena["b"], "ana") == 403
        assert _embed(client, cena, cena["c"], "ana") == 403
        assert _embed(client, cena, cena["b"], "beto") == 403

    def test_nao_entra_na_colecao_nem_lista_os_relatorios_dela(self, client, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])
        financeiro = cena["financeiro"].id

        assert client.get("/workspaces/", headers=cena["ana"]).json() == []
        assert client.get(f"/workspaces/{financeiro}", headers=cena["ana"]).status_code == 403
        assert client.get(f"/workspaces/{financeiro}/reports/", headers=cena["ana"]).status_code == 403
        assert client.get(f"/workspaces/{financeiro}/powerbi/refresh-info", headers=cena["ana"]).status_code == 403

    def test_le_os_dados_do_relatorio_dado_mas_nao_os_do_outro(self, client, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])
        financeiro = cena["financeiro"].id

        assert client.get(f"/workspaces/{financeiro}/reports/{cena['a'].id}", headers=cena["ana"]).status_code == 200
        assert client.get(f"/workspaces/{financeiro}/reports/{cena['b'].id}", headers=cena["ana"]).status_code == 403

    def test_a_busca_nao_acha_os_outros_relatorios_da_colecao(self, client, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])

        texto = client.get("/search/", params={"q": "B"}, headers=cena["ana"]).text

        assert '"name":"B"' not in texto.replace(" ", "")

    def test_aparece_em_compartilhados_comigo_so_o_que_foi_dado(self, client, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])

        lista = client.get("/report-access/shared-with-me", headers=cena["ana"]).json()

        assert [(r["name"], r["in_root"]) for r in lista] == [("A", False)]
        assert client.get("/report-access/shared-with-me", headers=cena["beto"]).json() == []

    def test_exportar_so_vale_no_relatorio_em_que_foi_dado(self, client, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.exportar"])  # o "ver" entra junto
        corpo = {"format": "PDF"}
        financeiro = cena["financeiro"].id

        assert client.post(f"/workspaces/{financeiro}/powerbi/reports/{cena['a'].id}/export-download", json=corpo, headers=cena["ana"]).status_code != 403
        assert client.post(f"/workspaces/{financeiro}/powerbi/reports/{cena['b'].id}/export-download", json=corpo, headers=cena["ana"]).status_code == 403

    def test_ver_nao_da_exportar(self, client, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])

        resposta = client.post(f"/workspaces/{cena['financeiro'].id}/powerbi/reports/{cena['a'].id}/export-download", json={"format": "PDF"}, headers=cena["ana"])

        assert resposta.status_code == 403

    def test_um_item_so_faz_o_que_diz_em_cada_item_do_relatorio(self, db_session, cena):
        """Cada item dado sozinho num relatorio vale nele (com o que exige) e em nenhum outro."""
        for chave in sorted(access_catalog.REPORT_CAPABLE):
            db_session.query(ReportGrant).delete()
            esperado = set(access_catalog.with_implied_report({chave}))
            for k in esperado:
                db_session.add(ReportGrant(report_id=cena["a"].id, user_id=cena["ana_id"], permission_key=k))
            db_session.commit()

            acesso = effective_access(db_session, cena["ana_id"])

            assert acesso.report_keys(cena["a"].id, cena["a"].collection_id) == esperado, chave
            assert acesso.report_keys(cena["b"].id, cena["b"].collection_id) == set(), chave
            assert acesso.by_workspace == {}, chave


class TestPermissoesAntigasContinuamValendo:
    def test_acesso_dado_a_colecao_abre_todos_os_relatorios_dela_sem_mexer_em_nada(self, client, cena):
        resposta = client.put(
            f"/access/users/{cena['beto_id']}",
            json={"blocks": [{"workspace_id": cena["financeiro"].id, "permissions": ["colecao.ver"]}]},
            headers=cena["admin"],
        )
        assert resposta.status_code == 200

        assert _embed(client, cena, cena["a"], "beto") != 403
        assert _embed(client, cena, cena["b"], "beto") != 403
        assert _embed(client, cena, cena["c"], "beto") == 403

    def test_exportar_dado_a_colecao_vale_em_cada_relatorio_dela(self, client, cena):
        client.put(
            f"/access/users/{cena['beto_id']}",
            json={"blocks": [{"workspace_id": cena["financeiro"].id, "permissions": ["colecao.ver", "relatorio.exportar"]}]},
            headers=cena["admin"],
        )
        financeiro = cena["financeiro"].id

        for chave in ("a", "b"):
            resposta = client.post(f"/workspaces/{financeiro}/powerbi/reports/{cena[chave].id}/export-download", json={"format": "PDF"}, headers=cena["beto"])
            assert resposta.status_code != 403

    def test_o_que_vem_da_colecao_e_o_que_vem_do_relatorio_se_somam(self, db_session, cena):
        from app.models.access_grant import AccessGrant

        db_session.add(AccessGrant(user_id=cena["ana_id"], workspace_id=cena["financeiro"].id, permission_key="colecao.ver"))
        db_session.add(ReportGrant(report_id=cena["a"].id, user_id=cena["ana_id"], permission_key="relatorio.exportar"))
        db_session.commit()

        acesso = effective_access(db_session, cena["ana_id"])

        assert acesso.report_keys(cena["a"].id, cena["financeiro"].id) == {"relatorio.ver", "relatorio.exportar"}
        assert acesso.report_keys(cena["b"].id, cena["financeiro"].id) == {"relatorio.ver"}

    def test_editor_de_permissoes_de_hoje_nao_apaga_o_que_foi_dado_num_relatorio(self, client, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])

        client.put(f"/access/users/{cena['ana_id']}", json={"blocks": [{"workspace_id": cena["comercial"].id, "permissions": ["colecao.ver"]}]}, headers=cena["admin"])

        assert _embed(client, cena, cena["a"], "ana") != 403

    def test_linha_com_item_que_nao_vale_num_relatorio_e_ignorada(self, db_session, cena):
        db_session.add(ReportGrant(report_id=cena["a"].id, user_id=cena["ana_id"], permission_key="colecao.excluir"))
        db_session.commit()

        assert effective_access(db_session, cena["ana_id"]).by_report == {}


class TestPorGrupo:
    def test_quem_esta_no_grupo_recebe_e_quem_sai_perde(self, client, db_session, cena):
        db_session.add(GroupMember(group_id=cena["grupo"].id, user_id=cena["ana_id"]))
        db_session.commit()
        resposta = client.put(f"/report-access/{cena['a'].id}/groups/{cena['grupo'].id}", json={"permissions": ["relatorio.ver"]}, headers=cena["admin"])
        assert resposta.status_code == 200

        assert _embed(client, cena, cena["a"], "ana") != 403
        assert _embed(client, cena, cena["a"], "beto") == 403

        db_session.query(GroupMember).filter_by(group_id=cena["grupo"].id, user_id=cena["ana_id"]).delete()
        db_session.commit()
        assert _embed(client, cena, cena["a"], "ana") == 403

    def test_o_grupo_administradores_nao_recebe_linhas(self, client, db_session, cena):
        admins = db_session.query(Group).filter(Group.is_admin_group.is_(True)).one()

        resposta = client.put(f"/report-access/{cena['a'].id}/groups/{admins.id}", json={"permissions": ["relatorio.ver"]}, headers=cena["admin"])

        assert resposta.status_code == 400
        assert db_session.query(ReportGrant).count() == 0


class TestDefesasContraEscalada:
    def test_sem_permissao_de_mexer_recebe_403(self, client, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])

        assert _dar(client, cena, cena["a"], "beto", ["relatorio.ver"], como="ana").status_code == 403
        assert client.get(f"/report-access/{cena['a'].id}", headers=cena["ana"]).status_code == 403

    def test_quem_compartilha_so_da_o_que_tem_naquele_relatorio(self, client, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.compartilhar"])  # o "ver" entra junto

        assert _dar(client, cena, cena["a"], "beto", ["relatorio.ver"], como="ana").status_code == 200
        negado = _dar(client, cena, cena["a"], "caio", ["relatorio.exportar"], como="ana")
        assert negado.status_code == 403 and "Faltam" in negado.json()["detail"]
        assert _dar(client, cena, cena["b"], "caio", ["relatorio.ver"], como="ana").status_code == 403

    def test_quem_compartilha_tambem_tira_so_o_que_tem(self, client, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.compartilhar"])
        _dar(client, cena, cena["a"], "beto", ["relatorio.ver", "relatorio.exportar"])

        assert _dar(client, cena, cena["a"], "beto", ["relatorio.ver"], como="ana").status_code == 403  # tiraria o exportar

    def test_permissao_geral_de_editar_permissoes_nao_passa_do_que_a_pessoa_tem(self, client, cena):
        client.put(f"/access/users/{cena['ana_id']}", json={"blocks": [{"workspace_id": None, "permissions": ["permissoes.editar"]}]}, headers=cena["admin"])

        assert _dar(client, cena, cena["a"], "beto", ["relatorio.ver"], como="ana").status_code == 403

    def test_item_que_nao_vale_num_relatorio_e_recusado(self, client, cena):
        resposta = _dar(client, cena, cena["a"], "ana", ["colecao.excluir"])

        assert resposta.status_code == 422

    def test_ninguem_da_acesso_ao_administrador_da_plataforma(self, client, db_session, cena):
        admin_id = db_session.query(User).filter_by(email="admin@example.com").one().id

        resposta = client.put(f"/report-access/{cena['a'].id}/users/{admin_id}", json={"permissions": ["relatorio.ver"]}, headers=cena["admin"])

        assert resposta.status_code == 400


class TestLote:
    def test_da_varios_relatorios_a_varias_pessoas_de_uma_vez(self, client, db_session, cena):
        corpo = {"report_ids": [cena["a"].id, cena["b"].id, cena["c"].id], "group_ids": [cena["grupo"].id], "user_ids": [cena["ana_id"]], "permissions": ["relatorio.exportar"]}

        resposta = client.post("/report-access/bulk", json=corpo, headers=cena["admin"])

        assert resposta.json() == {"reports": 3, "subjects": 2, "changes": 6}
        assert _embed(client, cena, cena["c"], "ana") != 403
        assert db_session.query(ReportGrant).filter_by(permission_key="relatorio.ver").count() == 6  # o "ver" entrou junto

    def test_repetir_o_pedido_nao_muda_nada(self, client, cena):
        corpo = {"report_ids": [cena["a"].id], "user_ids": [cena["ana_id"]], "permissions": ["relatorio.ver"]}
        client.post("/report-access/bulk", json=corpo, headers=cena["admin"])

        assert client.post("/report-access/bulk", json=corpo, headers=cena["admin"]).json()["changes"] == 0

    def test_tirar_o_ver_tira_tambem_o_que_depende_dele(self, client, db_session, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.exportar", "assinatura.criar"])

        resposta = client.post("/report-access/bulk", json={"report_ids": [cena["a"].id], "user_ids": [cena["ana_id"]], "permissions": ["relatorio.ver"], "mode": "remove"}, headers=cena["admin"])

        assert resposta.status_code == 200
        assert db_session.query(ReportGrant).count() == 0

    def test_o_pedido_inteiro_entra_ou_nenhuma_parte_dele(self, client, db_session, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.compartilhar"])
        corpo = {"report_ids": [cena["a"].id, cena["b"].id], "user_ids": [cena["beto_id"]], "permissions": ["relatorio.ver"]}

        resposta = client.post("/report-access/bulk", json=corpo, headers=cena["ana"])

        assert resposta.status_code == 403
        assert db_session.query(ReportGrant).filter_by(user_id=cena["beto_id"]).count() == 0

    def test_exige_ao_menos_um_grupo_ou_pessoa(self, client, cena):
        resposta = client.post("/report-access/bulk", json={"report_ids": [cena["a"].id], "permissions": ["relatorio.ver"]}, headers=cena["admin"])

        assert resposta.status_code == 422


class TestRaiz:
    def test_dar_um_relatorio_da_raiz_e_a_forma_de_publicar_o_que_veio_do_tenant(self, client, cena):
        assert _embed(client, cena, cena["r"], "ana") == 403

        _dar(client, cena, cena["r"], "ana", ["relatorio.ver"])

        assert _embed(client, cena, cena["r"], "ana") != 403
        lista = client.get("/report-access/shared-with-me", headers=cena["ana"]).json()
        assert [(r["name"], r["in_root"]) for r in lista] == [("R", True)]
        assert client.get("/workspaces/", headers=cena["ana"]).json() == []

    def test_o_que_foi_dado_num_relatorio_da_raiz_nao_abre_os_outros_da_raiz(self, client, cena, db_session):
        outro = Report(collection_id=cena["raiz"].id, name="R2", pbi_workspace_id="ws", pbi_report_id="rep-R2")
        db_session.add(outro)
        db_session.commit()
        _dar(client, cena, cena["r"], "ana", ["relatorio.ver"])

        assert _embed(client, cena, outro, "ana") == 403


class TestLimpeza:
    def test_excluir_o_relatorio_apaga_o_que_foi_dado_nele(self, client, db_session, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])
        db_session.add(ReportInviteGrant(email="novo@example.com", report_id=cena["a"].id, permission_key="relatorio.ver"))
        db_session.commit()

        resposta = client.delete(f"/workspaces/{cena['financeiro'].id}/reports/{cena['a'].id}", headers=cena["admin"])

        assert resposta.status_code == 204
        assert db_session.query(ReportGrant).count() == 0 and db_session.query(ReportInviteGrant).count() == 0

    def test_excluir_a_colecao_apaga_o_que_foi_dado_nos_relatorios_dela(self, client, db_session, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])
        _dar(client, cena, cena["c"], "ana", ["relatorio.ver"])

        client.delete(f"/workspaces/{cena['financeiro'].id}", headers=cena["admin"])

        assert [g.report_id for g in db_session.query(ReportGrant).all()] == [cena["c"].id]

    def test_excluir_a_pessoa_ou_o_grupo_apaga_o_que_eles_tinham(self, client, db_session, cena):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])
        client.put(f"/report-access/{cena['a'].id}/groups/{cena['grupo'].id}", json={"permissions": ["relatorio.ver"]}, headers=cena["admin"])

        assert client.delete(f"/groups/{cena['grupo'].id}", headers=cena["admin"]).status_code in (200, 204)
        assert db_session.query(ReportGrant).filter(ReportGrant.group_id.isnot(None)).count() == 0
        assert client.delete(f"/users/{cena['ana_id']}", headers=cena["admin"]).status_code in (200, 204)
        assert db_session.query(ReportGrant).count() == 0


class TestConvites:
    def test_quem_ja_tem_conta_recebe_na_hora(self, client, db_session, cena):
        corpo = {"email": "ana@example.com", "report_ids": [cena["a"].id], "permissions": ["relatorio.ver"]}

        resposta = client.post("/report-access/by-email", json=corpo, headers=cena["admin"])

        assert resposta.json() == {"status": "applied"}
        assert _embed(client, cena, cena["a"], "ana") != 403

    def test_sem_convite_pendente_nao_reserva_nada(self, client, db_session, cena):
        resposta = client.post("/report-access/by-email", json={"email": "novo@example.com", "report_ids": [cena["a"].id], "permissions": ["relatorio.ver"]}, headers=cena["admin"])

        assert resposta.status_code == 400
        assert db_session.query(ReportInviteGrant).count() == 0

    def test_o_reservado_vira_acesso_quando_a_conta_e_criada_com_convite(self, db_session, cena):
        db_session.add(ReportInviteGrant(email="novo@example.com", report_id=cena["a"].id, permission_key="relatorio.ver"))
        novo = User(name="Novo", email="novo@example.com", hashed_password="x")
        db_session.add(novo)
        db_session.commit()

        assert apply_pending_report_grants(db_session, novo, had_invites=True) is True
        db_session.commit()

        assert [(g.report_id, g.permission_key) for g in db_session.query(ReportGrant).filter_by(user_id=novo.id)] == [(cena["a"].id, "relatorio.ver")]
        assert db_session.query(ReportInviteGrant).count() == 0

    def test_sem_convite_o_reservado_e_descartado_e_nada_e_concedido(self, db_session, cena):
        db_session.add(ReportInviteGrant(email="novo@example.com", report_id=cena["a"].id, permission_key="relatorio.ver"))
        novo = User(name="Novo", email="novo@example.com", hashed_password="x")
        db_session.add(novo)
        db_session.commit()

        apply_pending_report_grants(db_session, novo, had_invites=False)
        db_session.commit()

        assert db_session.query(ReportGrant).count() == 0 and db_session.query(ReportInviteGrant).count() == 0


class TestConsultas:
    def test_matriz_mostra_o_direto_e_o_que_vem_da_colecao_por_grupo(self, client, db_session, cena):
        from app.models.access_grant import AccessGrant

        client.put(f"/report-access/{cena['a'].id}/groups/{cena['grupo'].id}", json={"permissions": ["relatorio.exportar"]}, headers=cena["admin"])
        db_session.add(AccessGrant(group_id=cena["grupo"].id, workspace_id=cena["financeiro"].id, permission_key="colecao.ver"))
        db_session.commit()

        dados = client.get("/report-access/matrix", params={"search": "A"}, headers=cena["admin"]).json()

        linha = next(r for r in dados["rows"] if r["report"]["name"] == "A")
        celula = linha["cells"][str(cena["grupo"].id)]
        assert celula["direct"] == ["relatorio.exportar", "relatorio.ver"]
        assert celula["inherited"] == ["relatorio.ver"]
        assert all(g["name"] != "Administradores" for g in dados["groups"])

    def test_matriz_filtra_pela_raiz(self, client, cena):
        dados = client.get("/report-access/matrix", params={"where": "root"}, headers=cena["admin"]).json()

        assert [r["report"]["name"] for r in dados["rows"]] == ["R"]
        assert dados["rows"][0]["report"]["in_root"] is True

    def test_matriz_e_so_de_quem_ve_membros_ou_grupos(self, client, cena):
        assert client.get("/report-access/matrix", headers=cena["ana"]).status_code == 403
        assert client.get(f"/report-access/person/{cena['beto_id']}", headers=cena["ana"]).status_code == 403

    def test_painel_da_pessoa_diz_de_onde_vem_cada_acesso(self, client, db_session, cena):
        from app.models.access_grant import AccessGrant

        db_session.add(GroupMember(group_id=cena["grupo"].id, user_id=cena["ana_id"]))
        db_session.add(AccessGrant(user_id=cena["ana_id"], workspace_id=cena["comercial"].id, permission_key="colecao.ver"))
        db_session.commit()
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])
        client.put(f"/report-access/{cena['b'].id}/groups/{cena['grupo'].id}", json={"permissions": ["relatorio.ver"]}, headers=cena["admin"])

        dados = client.get(f"/report-access/person/{cena['ana_id']}", headers=cena["admin"]).json()

        origens = {linha["report"]["name"]: linha["sources"] for linha in dados["rows"]}
        assert origens == {"A": ["Direto na pessoa"], "B": ["Grupo Turma de dados"], "C": ["Coleção Comercial"]}

    def test_painel_de_um_administrador_so_diz_que_ele_ve_tudo(self, client, db_session, cena):
        admin_id = db_session.query(User).filter_by(email="admin@example.com").one().id

        dados = client.get(f"/report-access/person/{admin_id}", headers=cena["admin"]).json()

        assert dados["is_admin"] is True and dados["rows"] == []

    def test_aviso_de_quantos_relatorios_uma_colecao_libera(self, client, cena):
        dados = client.get(f"/report-access/impact/collections/{cena['financeiro'].id}", headers=cena["admin"]).json()

        assert dados == {"reports": 2, "in_root": False}

    def test_quem_gerencia_ve_os_acessos_do_relatorio_com_a_origem(self, client, db_session, cena):
        from app.models.access_grant import AccessGrant

        db_session.add(AccessGrant(group_id=cena["grupo"].id, workspace_id=cena["financeiro"].id, permission_key="colecao.ver"))
        db_session.commit()
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])

        dados = client.get(f"/report-access/{cena['a'].id}", headers=cena["admin"]).json()

        assert dados["can_manage"] is True
        assert [u["email"] for u in dados["users"]] == ["ana@example.com"]
        grupo = next(g for g in dados["groups"] if g["id"] == cena["grupo"].id)
        assert grupo["from_collection"] == ["relatorio.ver"] and grupo["permissions"] == []
        assert client.get("/report-access/999999", headers=cena["admin"]).status_code == 404

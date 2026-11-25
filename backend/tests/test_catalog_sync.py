"""Catalogo na raiz e sincronizacao do tenant (fase 1). A API do Power BI e sempre simulada e todos os
dados sao ficticios."""

from datetime import datetime, timedelta, timezone

import pytest

from app.core import catalog_sync, powerbi
from app.core.root_collection import ROOT_KEY, ensure_root_collection
from app.models.access_grant import AccessGrant
from app.models.catalog_sync import CatalogSync, PbiDataset
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.workspace import Workspace

PASSWORD = "SenhaForte123"


class FakeTenant:
    """Um tenant ficticio: workspaces com relatorios e modelos, e falhas programadas."""

    def __init__(self):
        self.workspaces = [{"id": "ws-a", "name": "Financeiro"}, {"id": "ws-b", "name": "Comercial"}]
        self.reports = {
            "ws-a": [{"id": "rep-1", "name": "Resultado", "datasetId": "ds-1"}, {"id": "rep-2", "name": "Fluxo", "datasetId": "ds-1"}],
            "ws-b": [{"id": "rep-3", "name": "Vendas", "datasetId": "ds-2"}],
        }
        self.datasets = {
            "ws-a": [{"id": "ds-1", "name": "Modelo financeiro", "isEffectiveIdentityRequired": False}],
            "ws-b": [{"id": "ds-2", "name": "Modelo comercial", "isEffectiveIdentityRequired": True}],
        }
        self.fail_reports_in: set[str] = set()
        self.throttle_times = 0
        self.calls = 0

    def install(self, monkeypatch):
        def list_workspaces(connection):
            return list(self.workspaces)

        def list_reports(connection, workspace_id):
            self.calls += 1
            if self.throttle_times > 0:
                self.throttle_times -= 1
                raise powerbi.PowerBIError("Falha ao listar relatorios do Power BI: HTTP 429 -- limite")
            if workspace_id in self.fail_reports_in:
                raise powerbi.PowerBIError("Falha ao listar relatorios do Power BI: HTTP 403 -- sem acesso")
            return list(self.reports.get(workspace_id, []))

        def list_datasets(connection, workspace_id):
            return list(self.datasets.get(workspace_id, []))

        monkeypatch.setattr(powerbi, "list_workspaces", list_workspaces)
        monkeypatch.setattr(powerbi, "list_reports", list_reports)
        monkeypatch.setattr(powerbi, "list_datasets", list_datasets)
        monkeypatch.setattr(catalog_sync, "_sleep", lambda seconds: None)


@pytest.fixture
def tenant(monkeypatch):
    fake = FakeTenant()
    fake.install(monkeypatch)
    return fake


@pytest.fixture
def conexao(db_session):
    connection = PowerBIConnection(name="Conta ficticia", tenant_id="t", client_id="c", client_secret="s")
    db_session.add(connection)
    db_session.commit()
    db_session.refresh(connection)
    return connection


def _reports(db, **filters):
    return db.query(Report).filter_by(**filters).order_by(Report.pbi_report_id).all()


class TestSincronizacao:
    def test_importa_para_a_raiz_com_origem_e_modelos(self, db_session, conexao, tenant):
        record = catalog_sync.sync_connection(db_session, conexao)

        assert record.error is None
        assert (record.reports_new, record.reports_updated, record.reports_missing) == (3, 0, 0)
        assert (record.datasets_new, record.datasets_missing) == (2, 0)
        root = db_session.query(Workspace).filter(Workspace.system_key == ROOT_KEY).one()
        rows = _reports(db_session)
        assert {r.collection_id for r in rows} == {root.id}
        assert {r.source for r in rows} == {"sync"}
        assert {r.pbi_workspace_name for r in rows} == {"Financeiro", "Comercial"}
        assert all(r.synced_at is not None and r.sync_missing_at is None for r in rows)
        assert {d.pbi_dataset_id: d.is_effective_identity_required for d in db_session.query(PbiDataset).all()} == {"ds-1": False, "ds-2": True}

    def test_rodar_duas_vezes_seguidas_nao_duplica(self, db_session, conexao, tenant):
        catalog_sync.sync_connection(db_session, conexao)
        segunda = catalog_sync.sync_connection(db_session, conexao)

        assert db_session.query(Report).count() == 3
        assert db_session.query(PbiDataset).count() == 2
        assert (segunda.reports_new, segunda.reports_updated, segunda.reports_missing) == (0, 0, 0)
        assert db_session.query(CatalogSync).count() == 2

    def test_nome_novo_no_tenant_atualiza_o_relatorio_importado(self, db_session, conexao, tenant):
        catalog_sync.sync_connection(db_session, conexao)
        tenant.reports["ws-a"][0]["name"] = "Resultado 2026"
        record = catalog_sync.sync_connection(db_session, conexao)

        assert record.reports_updated == 1
        assert _reports(db_session, pbi_report_id="rep-1")[0].name == "Resultado 2026"

    def test_relatorio_cadastrado_a_mao_e_adotado_sem_mudar_de_colecao_nem_de_nome(self, db_session, conexao, tenant, make_workspace):
        colecao = make_workspace("Diretoria")
        manual = Report(
            collection_id=colecao.id, name="Meu nome", powerbi_connection_id=conexao.id, pbi_workspace_id="ws-a", pbi_report_id="rep-1"
        )
        db_session.add(manual)
        db_session.commit()

        record = catalog_sync.sync_connection(db_session, conexao)

        assert record.reports_new == 2  # rep-2 e rep-3; o rep-1 ja existia
        assert db_session.query(Report).count() == 3
        db_session.refresh(manual)
        assert manual.collection_id == colecao.id
        assert manual.name == "Meu nome"
        assert manual.source is None
        assert manual.synced_at is not None
        assert manual.pbi_workspace_name == "Financeiro"
        assert manual.pbi_dataset_id == "ds-1"  # o dataset estava vazio e foi preenchido

    def test_varias_linhas_do_mesmo_relatorio_com_abas_diferentes_sao_todas_adotadas(self, db_session, conexao, tenant, make_workspace):
        colecao = make_workspace("Diretoria")
        for nome, pagina in (("Resumo", "ReportSection1"), ("Detalhe", "ReportSection2")):
            db_session.add(
                Report(
                    collection_id=colecao.id, name=nome, powerbi_connection_id=conexao.id,
                    pbi_workspace_id="ws-a", pbi_report_id="rep-1", pbi_page_name=pagina,
                )
            )
        db_session.commit()

        catalog_sync.sync_connection(db_session, conexao)

        assert db_session.query(Report).filter_by(pbi_report_id="rep-1").count() == 2  # nenhuma copia na Raiz
        assert all(r.synced_at is not None for r in db_session.query(Report).filter_by(pbi_report_id="rep-1"))


class TestNaoEncontrado:
    def test_relatorio_removido_do_tenant_fica_marcado_e_mantem_as_permissoes(self, db_session, conexao, tenant, make_user):
        catalog_sync.sync_connection(db_session, conexao)
        removido = _reports(db_session, pbi_report_id="rep-2")[0]
        pessoa = make_user("pessoa@example.com")
        db_session.add(AccessGrant(user_id=pessoa.id, workspace_id=removido.collection_id, permission_key="colecao.ver"))
        db_session.commit()
        tenant.reports["ws-a"] = [r for r in tenant.reports["ws-a"] if r["id"] != "rep-2"]

        record = catalog_sync.sync_connection(db_session, conexao)

        assert record.reports_missing == 1
        db_session.refresh(removido)
        assert removido.sync_missing_at is not None
        assert db_session.query(Report).count() == 3  # nada foi apagado
        assert db_session.query(AccessGrant).filter_by(user_id=pessoa.id).count() == 1

    def test_relatorio_que_volta_a_aparecer_perde_a_marca(self, db_session, conexao, tenant):
        catalog_sync.sync_connection(db_session, conexao)
        voltando = tenant.reports["ws-a"].pop()
        catalog_sync.sync_connection(db_session, conexao)
        tenant.reports["ws-a"].append(voltando)

        catalog_sync.sync_connection(db_session, conexao)

        assert _reports(db_session, pbi_report_id="rep-2")[0].sync_missing_at is None

    def test_workspace_que_sumiu_do_tenant_marca_tudo_dele(self, db_session, conexao, tenant):
        catalog_sync.sync_connection(db_session, conexao)
        tenant.workspaces = [w for w in tenant.workspaces if w["id"] != "ws-b"]

        record = catalog_sync.sync_connection(db_session, conexao)

        assert record.reports_missing == 1 and record.datasets_missing == 1
        assert _reports(db_session, pbi_report_id="rep-3")[0].sync_missing_at is not None

    def test_falha_ao_listar_um_workspace_nao_marca_os_relatorios_dele_como_removidos(self, db_session, conexao, tenant):
        catalog_sync.sync_connection(db_session, conexao)
        tenant.fail_reports_in = {"ws-a"}

        record = catalog_sync.sync_connection(db_session, conexao)

        assert record.reports_missing == 0
        assert "Financeiro" in (record.error or "")
        assert all(r.sync_missing_at is None for r in _reports(db_session))

    def test_falha_total_do_tenant_fica_no_historico_sem_derrubar(self, db_session, conexao, monkeypatch):
        def quebrada(connection):
            raise powerbi.PowerBIError("Falha ao autenticar na Azure AD: HTTP 401")

        monkeypatch.setattr(powerbi, "list_workspaces", quebrada)

        record = catalog_sync.sync_connection(db_session, conexao)

        assert "401" in record.error
        assert record.finished_at is not None
        assert db_session.query(Report).count() == 0


class TestLimiteDeChamadas:
    def test_espera_e_tenta_de_novo_quando_o_power_bi_limita(self, db_session, conexao, tenant):
        tenant.throttle_times = 2

        record = catalog_sync.sync_connection(db_session, conexao)

        assert record.error is None
        assert record.reports_new == 3

    def test_desiste_depois_das_tentativas_e_registra_o_erro(self, db_session, conexao, tenant):
        tenant.throttle_times = 99

        record = catalog_sync.sync_connection(db_session, conexao)

        assert record.reports_new == 0
        assert "429" in record.error


class TestFiltroDeWorkspaces:
    def test_so_importa_os_workspaces_escolhidos_e_nao_marca_os_de_fora(self, db_session, conexao, tenant):
        catalog_sync.sync_connection(db_session, conexao)
        conexao.sync_workspaces_json = '["ws-a"]'
        db_session.commit()
        tenant.reports["ws-b"] = []  # ficaria "removido" se o filtro nao o protegesse
        tenant.reports["ws-a"].append({"id": "rep-9", "name": "Novo", "datasetId": "ds-1"})

        record = catalog_sync.sync_connection(db_session, conexao)

        assert record.reports_new == 1
        assert record.reports_missing == 0
        assert _reports(db_session, pbi_report_id="rep-3")[0].sync_missing_at is None

    def test_json_invalido_vale_como_todos(self, conexao):
        conexao.sync_workspaces_json = "isso nao e json"
        assert catalog_sync.selected_workspace_ids(conexao) == []


class TestRaiz:
    def test_criar_a_raiz_e_idempotente(self, db_session):
        primeira = ensure_root_collection(db_session)
        segunda = ensure_root_collection(db_session)

        assert primeira.id == segunda.id
        assert db_session.query(Workspace).filter(Workspace.system_key == ROOT_KEY).count() == 1

    def test_raiz_nasce_sem_nenhuma_concessao(self, db_session):
        raiz = ensure_root_collection(db_session)

        assert db_session.query(AccessGrant).filter_by(workspace_id=raiz.id).count() == 0


def _entrar(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def api(client, db_session, conexao, tenant):
    admin = _entrar(client, "admin@example.com")
    pessoa = _entrar(client, "pessoa@example.com")
    ids = {u["email"]: u["id"] for u in client.get("/users/", headers=admin).json()}
    catalog_sync.sync_connection(db_session, conexao)
    return {"admin": admin, "pessoa": pessoa, "pessoa_id": ids["pessoa@example.com"], "conexao_id": conexao.id}


def _dar_global(client, api, *chaves):
    resposta = client.put(
        f"/access/users/{api['pessoa_id']}", json={"blocks": [{"workspace_id": None, "permissions": list(chaves)}]}, headers=api["admin"]
    )
    assert resposta.status_code == 200, resposta.text


class TestUsuarioComumNaoEnxergaOImportado:
    def test_nenhuma_lista_de_colecoes_mostra_a_raiz_nem_para_o_administrador(self, client, api):
        for cabecalho in (api["admin"], api["pessoa"]):
            nomes = [w["name"] for w in client.get("/workspaces/", headers=cabecalho).json()]
            assert "Raiz" not in nomes
        todas = [w["name"] for w in client.get("/workspaces/all", headers=api["admin"]).json()]
        assert "Raiz" not in todas

    def test_busca_nao_acha_relatorio_importado(self, client, api):
        for cabecalho in (api["admin"], api["pessoa"]):
            resposta = client.get("/search/", params={"q": "Resultado"}, headers=cabecalho)
            assert "Resultado" not in resposta.text

    def test_pessoa_comum_nao_abre_a_raiz_nem_os_relatorios_importados(self, client, db_session, api):
        raiz = db_session.query(Workspace).filter(Workspace.system_key == ROOT_KEY).one()
        relatorio = _reports(db_session, pbi_report_id="rep-1")[0]

        assert client.get(f"/workspaces/{raiz.id}", headers=api["pessoa"]).status_code == 403
        assert client.get(f"/workspaces/{raiz.id}/reports/", headers=api["pessoa"]).status_code == 403
        assert client.get(f"/workspaces/{raiz.id}/powerbi/reports/{relatorio.id}/embed", headers=api["pessoa"]).status_code == 403

    def test_ninguem_concede_acesso_a_raiz(self, client, db_session, api):
        raiz = db_session.query(Workspace).filter(Workspace.system_key == ROOT_KEY).one()

        resposta = client.put(
            f"/access/users/{api['pessoa_id']}",
            json={"blocks": [{"workspace_id": raiz.id, "permissions": ["colecao.ver"]}]},
            headers=api["admin"],
        )

        assert resposta.status_code == 404
        assert client.get("/workspaces/", headers=api["pessoa"]).json() == []

    def test_a_raiz_nao_pode_ser_editada_nem_excluida(self, client, db_session, api):
        raiz = db_session.query(Workspace).filter(Workspace.system_key == ROOT_KEY).one()

        assert client.put(f"/workspaces/{raiz.id}", json={"name": "Outro"}, headers=api["admin"]).status_code == 400
        assert client.delete(f"/workspaces/{raiz.id}", headers=api["admin"]).status_code == 400
        assert db_session.query(Report).count() == 3

    def test_a_raiz_nao_pode_ser_a_colecao_padrao(self, client, db_session, api):
        raiz = db_session.query(Workspace).filter(Workspace.system_key == ROOT_KEY).one()

        resposta = client.put("/settings/", json={"default_workspace_id": raiz.id}, headers=api["admin"])

        assert resposta.status_code in (400, 404, 422)


class TestRotasDaSincronizacao:
    def test_pessoa_sem_a_permissao_recebe_403(self, client, api):
        assert client.post(f"/powerbi-connections/{api['conexao_id']}/sync", headers=api["pessoa"]).status_code == 403
        assert client.get("/catalog/reports", headers=api["pessoa"]).status_code == 403
        assert client.get("/catalog/datasets", headers=api["pessoa"]).status_code == 403

    def test_botao_cria_um_trabalho_e_reaproveita_o_que_ja_esta_rodando(self, client, api, monkeypatch):
        iniciados = []
        monkeypatch.setattr(catalog_sync, "_run_job", lambda job: iniciados.append(job.id))
        catalog_sync._jobs.clear()

        primeira = client.post(f"/powerbi-connections/{api['conexao_id']}/sync", headers=api["admin"])
        segunda = client.post(f"/powerbi-connections/{api['conexao_id']}/sync", headers=api["admin"])

        assert primeira.status_code == 202
        assert segunda.json()["job_id"] == primeira.json()["job_id"]
        status = client.get(f"/powerbi-connections/{api['conexao_id']}/sync-jobs/{primeira.json()['job_id']}", headers=api["admin"])
        assert status.status_code == 200 and status.json()["status"] == "queued"
        catalog_sync._jobs.clear()

    def test_trabalho_de_outra_conta_nao_aparece(self, client, api):
        assert client.get(f"/powerbi-connections/{api['conexao_id']}/sync-jobs/nao-existe", headers=api["admin"]).status_code == 404

    def test_configuracoes_gravam_workspaces_e_agenda(self, client, api):
        resposta = client.put(
            f"/powerbi-connections/{api['conexao_id']}/sync-settings",
            json={"workspace_ids": ["ws-a", "ws-a", " "], "interval_hours": 6},
            headers=api["admin"],
        )

        assert resposta.status_code == 200
        assert resposta.json()["workspace_ids"] == ["ws-a"]
        assert resposta.json()["interval_hours"] == 6
        status = client.get(f"/powerbi-connections/{api['conexao_id']}/sync-status", headers=api["admin"]).json()
        assert status["last_sync"]["reports_new"] == 3

    def test_agenda_invalida_e_recusada(self, client, api):
        for horas in (0, -1, 721):
            resposta = client.put(f"/powerbi-connections/{api['conexao_id']}/sync-settings", json={"interval_hours": horas}, headers=api["admin"])
            assert resposta.status_code == 422

    def test_lista_os_workspaces_do_tenant_para_escolher(self, client, api):
        resposta = client.get(f"/powerbi-connections/{api['conexao_id']}/tenant-workspaces", headers=api["admin"])

        assert [w["name"] for w in resposta.json()] == ["Comercial", "Financeiro"]

    def test_so_quem_tem_a_permissao_sincroniza_e_ela_exige_ver_conexoes(self, client, api):
        _dar_global(client, api, "conexao.sincronizar")

        assert client.get(f"/powerbi-connections/{api['conexao_id']}/sync-status", headers=api["pessoa"]).status_code == 200
        assert client.get("/powerbi-connections/", headers=api["pessoa"]).status_code == 200  # exigido pelo "requires"
        assert client.get("/catalog/reports", headers=api["pessoa"]).status_code == 403


class TestListaDoCatalogo:
    def test_pagina_filtra_e_diz_onde_cada_relatorio_esta(self, client, api):
        _dar_global(client, api, "relatorio.catalogo")

        pagina = client.get("/catalog/reports", params={"page_size": 2}, headers=api["pessoa"]).json()
        assert pagina["total"] == 3 and len(pagina["items"]) == 2
        assert all(item["in_root"] and item["collection_name"] == "Raiz" for item in pagina["items"])

        por_origem = client.get("/catalog/reports", params={"workspace": "Comercial"}, headers=api["pessoa"]).json()
        assert [i["name"] for i in por_origem["items"]] == ["Vendas"]
        por_texto = client.get("/catalog/reports", params={"search": "flu"}, headers=api["pessoa"]).json()
        assert [i["name"] for i in por_texto["items"]] == ["Fluxo"]
        assert client.get("/catalog/origins", headers=api["pessoa"]).json() == ["Comercial", "Financeiro"]

    def test_filtro_de_nao_encontrado(self, client, db_session, api):
        _dar_global(client, api, "relatorio.catalogo")
        _reports(db_session, pbi_report_id="rep-2")[0].sync_missing_at = datetime.now(timezone.utc)
        db_session.commit()

        faltando = client.get("/catalog/reports", params={"state": "missing"}, headers=api["pessoa"]).json()
        bons = client.get("/catalog/reports", params={"state": "ok"}, headers=api["pessoa"]).json()

        assert [i["name"] for i in faltando["items"]] == ["Fluxo"]
        assert bons["total"] == 2

    def test_busca_trata_porcentagem_como_texto(self, client, api):
        _dar_global(client, api, "relatorio.catalogo")

        resposta = client.get("/catalog/reports", params={"search": "%"}, headers=api["pessoa"]).json()

        assert resposta["total"] == 0

    def test_lista_de_modelos_conta_os_relatorios_de_cada_um(self, client, api):
        _dar_global(client, api, "modelo.catalogo")

        itens = {i["name"]: i for i in client.get("/catalog/datasets", headers=api["pessoa"]).json()["items"]}

        assert itens["Modelo financeiro"]["reports_count"] == 2
        assert itens["Modelo comercial"]["requires_identity"] is True


class TestAquecimentoDoCache:
    def test_relatorio_importado_nao_e_aquecido(self, db_session, conexao, tenant, make_workspace, monkeypatch):
        from app.core import cache_warmup
        from app.routers import powerbi as embed_router

        catalog_sync.sync_connection(db_session, conexao)
        manual = Report(
            collection_id=make_workspace("Diretoria").id, name="Manual", powerbi_connection_id=conexao.id,
            pbi_workspace_id="ws-z", pbi_report_id="rep-z",
        )
        db_session.add(manual)
        db_session.commit()
        aquecidos = []
        monkeypatch.setattr(embed_router, "warm_report", lambda connection, collection_id, report, renew: aquecidos.append(report.pbi_report_id) or False)
        monkeypatch.setattr(embed_router, "warm_dataset_refresh_info", lambda *args, **kwargs: None)
        monkeypatch.setattr("app.core.database.SessionLocal", lambda: db_session)
        monkeypatch.setattr(db_session, "close", lambda: None)

        cache_warmup.warm_once(timedelta(seconds=300))

        assert aquecidos == ["rep-z"]


class TestSincronizacaoAgendada:
    def _ligar(self, db_session, conexao, horas, monkeypatch):
        conexao.sync_interval_hours = horas
        db_session.commit()
        monkeypatch.setattr(catalog_sync, "SessionLocal", lambda: db_session)
        monkeypatch.setattr(db_session, "close", lambda: None)

    def test_conta_sem_intervalo_nunca_sincroniza_sozinha(self, db_session, conexao, tenant, monkeypatch):
        self._ligar(db_session, conexao, None, monkeypatch)

        assert catalog_sync.run_scheduled_once() == 0
        assert db_session.query(CatalogSync).count() == 0

    def test_sincroniza_quando_o_intervalo_passou_e_espera_quando_nao(self, db_session, conexao, tenant, monkeypatch):
        self._ligar(db_session, conexao, 6, monkeypatch)

        assert catalog_sync.run_scheduled_once() == 1
        assert catalog_sync.run_scheduled_once() == 0  # a ultima rodada e recente
        ultima = db_session.query(CatalogSync).one()
        assert ultima.started_by_user_id is None
        ultima.started_at = datetime.now(timezone.utc) - timedelta(hours=7)
        db_session.commit()
        assert catalog_sync.run_scheduled_once() == 1


class TestBancoAntigo:
    def test_colunas_novas_entram_em_banco_de_versao_anterior(self):
        """Sobe o schema novo sobre as tabelas como eram na v1.46.0 (sem as colunas da fase 1)."""
        from sqlalchemy import create_engine, inspect, text
        from sqlalchemy.pool import StaticPool

        from app.core.database import Base
        from app.core.schema_migrations import ensure_schema_up_to_date

        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE workspaces (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, tv_interval_seconds INTEGER NOT NULL DEFAULT 15)"))
            conn.execute(text("CREATE TABLE powerbi_connections (id INTEGER PRIMARY KEY, name TEXT NOT NULL, tenant_id TEXT NOT NULL, client_id TEXT NOT NULL, client_secret TEXT NOT NULL)"))
            conn.execute(text("CREATE TABLE reports (id INTEGER PRIMARY KEY, collection_id INTEGER NOT NULL, name TEXT NOT NULL, pbi_workspace_id TEXT NOT NULL, pbi_report_id TEXT NOT NULL, display_type TEXT NOT NULL)"))
            conn.execute(text("INSERT INTO workspaces (id, name, slug) VALUES (1, 'Antiga', 'antiga')"))
            conn.execute(text("INSERT INTO reports (id, collection_id, name, pbi_workspace_id, pbi_report_id, display_type) VALUES (1, 1, 'R', 'w', 'r', 'relatorio')"))

        Base.metadata.create_all(bind=engine)
        ensure_schema_up_to_date(engine, Base)

        inspetor = inspect(engine)
        assert {"source", "synced_at", "sync_missing_at", "pbi_workspace_name"} <= {c["name"] for c in inspetor.get_columns("reports")}
        assert "system_key" in {c["name"] for c in inspetor.get_columns("workspaces")}
        assert {"sync_workspaces_json", "sync_interval_hours"} <= {c["name"] for c in inspetor.get_columns("powerbi_connections")}
        assert inspetor.has_table("catalog_syncs") and inspetor.has_table("pbi_datasets")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT reports.name, source, system_key FROM reports JOIN workspaces ON workspaces.id = reports.collection_id")).fetchone() == ("R", None, None)
        engine.dispose()

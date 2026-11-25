"""Escopo de conta nas permissoes e sincronizacao agendada visivel (v1.52.0). A API do Power BI e sempre simulada."""

import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

from app.core import access_catalog, catalog_sync, catalog_sync_runner, powerbi as powerbi_core
from app.core.access_engine import effective_access
from app.models.access_grant import AccessGrant
from app.models.catalog_sync import CatalogSync
from app.models.connection_grant import ConnectionGrant
from app.models.powerbi_connection import PowerBIConnection
from app.models.user import User
from app.models.workspace import Group, GroupMember

PASSWORD = "SenhaForte123"


def _entrar(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def cena(client, db_session):
    admin = _entrar(client, "admin@example.com")
    ana = _entrar(client, "ana@example.com")
    beto = _entrar(client, "beto@example.com")
    caio = _entrar(client, "caio@example.com")
    ids = {u.email: u.id for u in db_session.query(User).all()}
    conta_a = PowerBIConnection(name="Conta A", tenant_id="ta", client_id="ca", client_secret="s")
    conta_b = PowerBIConnection(name="Conta B", tenant_id="tb", client_id="cb", client_secret="s")
    grupo = Group(name="Dados")
    db_session.add_all([conta_a, conta_b, grupo])
    db_session.commit()
    return {
        "admin": admin, "ana": ana, "beto": beto, "caio": caio, "ana_id": ids["ana@example.com"], "beto_id": ids["beto@example.com"],
        "caio_id": ids["caio@example.com"], "a": conta_a, "b": conta_b, "grupo": grupo,
    }


def _dar(client, cena, conta, quem, preset="sincronizar", como="admin"):
    return client.put(f"/access-panel/connection/{conta.id}/user/{cena[quem + '_id']}", json={"preset": preset}, headers=cena[como])


@pytest.fixture
def sem_thread(monkeypatch):
    """A sincronizacao em segundo plano nao roda de verdade: o trabalho so e criado."""
    monkeypatch.setattr(catalog_sync, "_run_job", lambda job: None)
    catalog_sync._jobs.clear()
    yield
    catalog_sync._jobs.clear()


class TestEscopoDeConta:
    def test_o_catalogo_diz_que_sincronizar_vale_numa_conta_e_no_geral(self):
        assert access_catalog.CONNECTION_CAPABLE == {"conexao.sincronizar"}
        assert access_catalog.scope_of("conexao.sincronizar") == "global"

    def test_um_item_dado_numa_conta_vale_so_nela(self, db_session, cena):
        db_session.add(ConnectionGrant(connection_id=cena["a"].id, user_id=cena["ana_id"], permission_key="conexao.sincronizar"))
        db_session.commit()

        acesso = effective_access(db_session, cena["ana_id"])

        assert acesso.has_in_connection("conexao.sincronizar", cena["a"].id) is True
        assert acesso.has_in_connection("conexao.sincronizar", cena["b"].id) is False
        assert acesso.global_keys == set() and acesso.by_workspace == {} and acesso.by_report == {}
        assert acesso.connections_with("conexao.sincronizar") == {cena["a"].id}

    def test_a_permissao_geral_vale_em_todas_as_contas(self, db_session, cena):
        db_session.add(AccessGrant(user_id=cena["ana_id"], workspace_id=None, permission_key="conexao.sincronizar"))
        db_session.commit()

        acesso = effective_access(db_session, cena["ana_id"])

        assert acesso.has_in_connection("conexao.sincronizar", cena["a"].id) and acesso.has_in_connection("conexao.sincronizar", cena["b"].id)

    def test_o_grupo_da_pessoa_tambem_vale(self, db_session, cena):
        db_session.add(GroupMember(group_id=cena["grupo"].id, user_id=cena["ana_id"]))
        db_session.add(ConnectionGrant(connection_id=cena["b"].id, group_id=cena["grupo"].id, permission_key="conexao.sincronizar"))
        db_session.commit()

        assert effective_access(db_session, cena["ana_id"]).has_in_connection("conexao.sincronizar", cena["b"].id)
        assert not effective_access(db_session, cena["beto_id"]).has_in_connection("conexao.sincronizar", cena["b"].id)

    def test_linha_com_item_que_nao_vale_numa_conta_e_ignorada(self, db_session, cena):
        db_session.add(ConnectionGrant(connection_id=cena["a"].id, user_id=cena["ana_id"], permission_key="conexao.excluir"))
        db_session.commit()

        assert effective_access(db_session, cena["ana_id"]).by_connection == {}


class TestRotasDeSincronizacao:
    def test_quem_so_tem_a_conta_a_sincroniza_a_e_nao_a_b(self, client, cena, sem_thread):
        assert _dar(client, cena, cena["a"], "ana").status_code == 200

        assert client.post(f"/powerbi-connections/{cena['a'].id}/sync", headers=cena["ana"]).status_code == 202
        assert client.post(f"/powerbi-connections/{cena['b'].id}/sync", headers=cena["ana"]).status_code == 403
        assert client.get(f"/powerbi-connections/{cena['a'].id}/sync-status", headers=cena["ana"]).status_code == 200
        assert client.get(f"/powerbi-connections/{cena['b'].id}/sync-status", headers=cena["ana"]).status_code == 403
        assert client.put(f"/powerbi-connections/{cena['b'].id}/sync-settings", json={"interval_hours": 6}, headers=cena["ana"]).status_code == 403

    def test_o_acompanhamento_do_trabalho_e_da_agenda_tambem_so_na_conta_dela(self, client, cena, sem_thread):
        _dar(client, cena, cena["a"], "ana")
        job = client.post(f"/powerbi-connections/{cena['a'].id}/sync", headers=cena["ana"]).json()["job_id"]

        assert client.get(f"/powerbi-connections/{cena['a'].id}/sync-jobs/{job}", headers=cena["ana"]).status_code == 200
        configurou = client.put(f"/powerbi-connections/{cena['a'].id}/sync-settings", json={"workspace_ids": ["ws"], "interval_hours": 12}, headers=cena["ana"])
        assert configurou.status_code == 200 and configurou.json()["interval_hours"] == 12

    def test_listar_os_workspaces_do_tenant_para_escolher(self, client, cena, monkeypatch):
        monkeypatch.setattr(powerbi_core, "list_workspaces", lambda connection: [{"id": "w1", "name": "Financeiro"}])
        _dar(client, cena, cena["a"], "ana")

        assert client.get(f"/powerbi-connections/{cena['a'].id}/tenant-workspaces", headers=cena["ana"]).json() == [{"id": "w1", "name": "Financeiro"}]
        assert client.get(f"/powerbi-connections/{cena['b'].id}/tenant-workspaces", headers=cena["ana"]).status_code == 403

    def test_a_permissao_geral_continua_valendo_em_todas(self, client, cena, sem_thread):
        client.put(f"/access/users/{cena['beto_id']}", json={"blocks": [{"workspace_id": None, "permissions": ["conexao.sincronizar"]}]}, headers=cena["admin"])

        assert client.post(f"/powerbi-connections/{cena['a'].id}/sync", headers=cena["beto"]).status_code == 202
        assert client.post(f"/powerbi-connections/{cena['b'].id}/sync", headers=cena["beto"]).status_code == 202

    def test_quem_nao_tem_nada_continua_sem_acesso(self, client, cena):
        assert client.post(f"/powerbi-connections/{cena['a'].id}/sync", headers=cena["caio"]).status_code == 403


class TestPainelDeConta:
    def test_o_painel_lista_quem_tem_acesso_a_conta(self, client, db_session, cena):
        _dar(client, cena, cena["a"], "ana")
        client.put(f"/access-panel/connection/{cena['a'].id}/group/{cena['grupo'].id}", json={"preset": "sincronizar"}, headers=cena["admin"])

        dados = client.get(f"/access-panel/connection/{cena['a'].id}", headers=cena["admin"]).json()

        assert dados["item"] == {"kind": "connection", "id": cena["a"].id, "name": "Conta A", "subtitle": None}
        assert {(e["subject_kind"], e["name"], e["preset"]) for e in dados["entries"]} == {("user", "Ana", "sincronizar"), ("group", "Dados", "sincronizar")}
        assert [p["key"] for p in dados["presets"]] == ["sincronizar"]
        assert [p["key"] for p in dados["permissions"]] == ["conexao.sincronizar"]

    def test_vazio_remove_e_item_que_nao_vale_numa_conta_e_recusado(self, client, db_session, cena):
        _dar(client, cena, cena["a"], "ana")

        assert client.put(f"/access-panel/connection/{cena['a'].id}/user/{cena['ana_id']}", json={"permissions": ["conexao.excluir"]}, headers=cena["admin"]).status_code == 422
        client.put(f"/access-panel/connection/{cena['a'].id}/user/{cena['ana_id']}", json={"permissions": []}, headers=cena["admin"])
        assert db_session.query(ConnectionGrant).count() == 0

    def test_so_quem_edita_permissoes_mexe_e_so_no_que_tem(self, client, cena):
        assert _dar(client, cena, cena["a"], "beto", como="caio").status_code == 403
        client.put(f"/access/users/{cena['ana_id']}", json={"blocks": [{"workspace_id": None, "permissions": ["permissoes.editar", "membros.ver", "grupos.ver"]}]}, headers=cena["admin"])

        negado = _dar(client, cena, cena["a"], "beto", como="ana")  # ela edita permissoes, mas nao tem "sincronizar" nesta conta
        assert negado.status_code == 403 and "Faltam" in negado.json()["detail"]

        _dar(client, cena, cena["a"], "ana")  # agora ela tem na conta A
        assert _dar(client, cena, cena["a"], "beto", como="ana").status_code == 200
        assert _dar(client, cena, cena["b"], "caio", como="ana").status_code == 403  # mas nao na B

    def test_conta_nao_tem_convite_por_e_mail(self, client, cena):
        resposta = client.post(f"/access-panel/connection/{cena['a'].id}/invite", json={"email": "nova@example.com", "preset": "sincronizar"}, headers=cena["admin"])

        assert resposta.status_code == 400 and "ja ter conta" in resposta.json()["detail"]

    def test_o_catalogo_de_presets_da_conta(self, client, cena):
        dados = client.get("/access-panel/catalog/connection", headers=cena["ana"]).json()

        assert [p["label"] for p in dados["presets"]] == ["Sincronizar"] and [p["key"] for p in dados["permissions"]] == ["conexao.sincronizar"]

    def test_o_admin_da_plataforma_nao_recebe_linhas(self, client, db_session, cena):
        admin_id = db_session.query(User).filter_by(email="admin@example.com").one().id

        assert client.put(f"/access-panel/connection/{cena['a'].id}/user/{admin_id}", json={"preset": "sincronizar"}, headers=cena["admin"]).status_code == 400

    def test_conta_que_nao_existe(self, client, cena):
        assert client.get("/access-panel/connection/99999", headers=cena["admin"]).status_code == 404

    def test_lista_por_pessoa_e_lote_incluem_contas(self, client, cena):
        _dar(client, cena, cena["a"], "ana")

        lista = client.get(f"/access-panel/by-subject/user/{cena['ana_id']}", params={"kind": "connection"}, headers=cena["admin"]).json()
        lote = client.post("/access-panel/bulk", json={"items": [{"kind": "connection", "id": cena["a"].id}, {"kind": "connection", "id": cena["b"].id}], "user_ids": [cena["beto_id"]], "preset": "sincronizar"}, headers=cena["admin"])

        assert [(i["name"], i["preset"]) for i in lista["items"]] == [("Conta A", "sincronizar")]
        assert lote.json() == {"items": 2, "subjects": 1, "changes": 2}

    def test_o_access_me_traz_as_contas(self, client, cena):
        _dar(client, cena, cena["b"], "ana")

        assert client.get("/access/me", headers=cena["ana"]).json()["connection_permissions"] == {str(cena["b"].id): ["conexao.sincronizar"]}

    def test_excluir_a_pessoa_o_grupo_ou_a_conta_apaga_o_que_foi_dado(self, client, db_session, cena):
        _dar(client, cena, cena["a"], "ana")
        client.put(f"/access-panel/connection/{cena['a'].id}/group/{cena['grupo'].id}", json={"preset": "sincronizar"}, headers=cena["admin"])
        _dar(client, cena, cena["b"], "beto")

        assert client.delete(f"/groups/{cena['grupo'].id}", headers=cena["admin"]).status_code in (200, 204)
        assert client.delete(f"/users/{cena['ana_id']}", headers=cena["admin"]).status_code in (200, 204)
        assert db_session.query(ConnectionGrant).count() == 1
        assert client.delete(f"/powerbi-connections/{cena['b'].id}", headers=cena["admin"]).status_code == 204
        assert db_session.query(ConnectionGrant).count() == 0


class TestAgendaVisivelNaConta:
    def test_por_padrao_esta_desligada(self, client, cena):
        conta = {c["name"]: c for c in client.get("/powerbi-connections/", headers=cena["admin"]).json()}["Conta A"]

        assert conta["sync_interval_hours"] is None and conta["last_sync_at"] is None and conta["next_sync_at"] is None

    def test_a_proxima_rodada_e_a_ultima_mais_o_intervalo(self, client, db_session, cena):
        inicio = datetime.now(timezone.utc) - timedelta(hours=2)
        db_session.add(CatalogSync(connection_id=cena["a"].id, started_at=inicio, finished_at=inicio))
        cena["a"].sync_interval_hours = 6
        db_session.commit()

        conta = {c["name"]: c for c in client.get("/powerbi-connections/", headers=cena["admin"]).json()}["Conta A"]
        status = client.get(f"/powerbi-connections/{cena['a'].id}/sync-status", headers=cena["admin"]).json()

        assert conta["sync_interval_hours"] == 6
        esperado = inicio + timedelta(hours=6)
        assert abs(datetime.fromisoformat(conta["next_sync_at"].replace("Z", "+00:00")).timestamp() - esperado.timestamp()) < 2
        assert status["next_run_at"] is not None and status["interval_hours"] == 6

    def test_com_intervalo_e_sem_rodada_nao_inventa_data(self, client, db_session, cena):
        cena["a"].sync_interval_hours = 24
        db_session.commit()

        conta = {c["name"]: c for c in client.get("/powerbi-connections/", headers=cena["admin"]).json()}["Conta A"]

        assert conta["sync_interval_hours"] == 24 and conta["next_sync_at"] is None

    def test_funcao_pura_da_proxima_rodada(self):
        agora = datetime(2026, 11, 25, 10, 0, tzinfo=timezone.utc)

        assert catalog_sync.next_scheduled_at(6, agora) == agora + timedelta(hours=6)
        assert catalog_sync.next_scheduled_at(None, agora) is None
        assert catalog_sync.next_scheduled_at(0, agora) is None
        assert catalog_sync.next_scheduled_at(6, None) is None
        assert catalog_sync.next_scheduled_at(6, agora.replace(tzinfo=None)) == agora + timedelta(hours=6)


class TestRotinaDeFundo:
    def test_a_rotina_sobe_roda_e_para_sem_mexer_no_banco_real(self, monkeypatch):
        chamadas = []
        ocorreu = threading.Event()

        def uma_rodada():
            chamadas.append(1)
            ocorreu.set()
            return 0

        monkeypatch.setattr(catalog_sync, "run_scheduled_once", uma_rodada)
        monkeypatch.setattr(catalog_sync_runner, "TICK_SECONDS", 0.05)
        catalog_sync_runner._thread = None
        catalog_sync_runner.start()
        try:
            assert ocorreu.wait(3), "a rotina nao rodou"
            assert catalog_sync_runner._thread is not None and catalog_sync_runner._thread.is_alive()
            catalog_sync_runner.start()  # chamar de novo nao abre uma segunda rotina
            threads = [t for t in threading.enumerate() if t.name == "catalog-sync-runner"]
            assert len(threads) == 1
        finally:
            catalog_sync_runner.stop()
            time.sleep(0.3)
        assert not catalog_sync_runner._thread.is_alive()

    def test_um_erro_numa_rodada_nao_derruba_a_rotina(self, monkeypatch):
        estados = {"n": 0}
        segunda = threading.Event()

        def quebra_e_segue():
            estados["n"] += 1
            if estados["n"] == 1:
                raise RuntimeError("falha de uma rodada")
            segunda.set()
            return 0

        monkeypatch.setattr(catalog_sync, "run_scheduled_once", quebra_e_segue)
        monkeypatch.setattr(catalog_sync_runner, "TICK_SECONDS", 0.05)
        catalog_sync_runner._thread = None
        catalog_sync_runner.start()
        try:
            assert segunda.wait(3), "a rotina morreu depois do erro"
        finally:
            catalog_sync_runner.stop()
            time.sleep(0.3)

    def test_o_padrao_de_toda_conta_e_nunca_sincronizar_sozinha(self, db_session, cena, monkeypatch):
        monkeypatch.setattr(catalog_sync, "SessionLocal", lambda: db_session)
        monkeypatch.setattr(db_session, "close", lambda: None)

        assert catalog_sync.run_scheduled_once() == 0
        assert db_session.query(CatalogSync).count() == 0

    def test_o_lifespan_do_app_liga_e_desliga_a_rotina(self):
        from app.main import _lifespan, app

        chamadas = []
        original_start, original_stop = catalog_sync_runner.start, catalog_sync_runner.stop
        catalog_sync_runner.start = lambda: chamadas.append("start")
        catalog_sync_runner.stop = lambda: chamadas.append("stop")
        try:
            import asyncio

            async def ciclo():
                async with _lifespan(app):
                    pass

            asyncio.run(ciclo())
        finally:
            catalog_sync_runner.start, catalog_sync_runner.stop = original_start, original_stop

        assert chamadas == ["start", "stop"]

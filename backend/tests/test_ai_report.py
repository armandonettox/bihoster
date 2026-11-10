"""Configuracao de IA por relatorio: quem pode ver e mudar, o que a tela "o que a IA enxerga" devolve
(so nomes e contagens), orientacoes, colunas bloqueadas e a limpeza ao apagar o relatorio."""

from unittest.mock import patch

import pytest

from app.core import ai_report_settings, chat_dataset, chat_images
from app.core.chat_dataset import ChatDataError, DatasetSchema, Eligibility, SchemaColumn, SchemaTable
from app.core.workspace_deps import ensure_default_group_access
from app.models.ai_report_settings import AIReportSettings
from app.models.audit_log import AuditLog
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.workspace import Workspace

PASSWORD = "SenhaForte123"

ESQUEMA = DatasetSchema(
    tables=(
        SchemaTable(
            "fato",
            (SchemaColumn("unidade", "texto", 1377), SchemaColumn("valor", "decimal")),
            (("Custo", "Soma do custo"),),
        ),
        SchemaTable("dim_unidade", (SchemaColumn("uf", "texto", 5),), ()),
    ),
    hidden_columns=3,
)


def _headers(client, email: str) -> dict:
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(client):
    return _headers(client, "admin@example.com")  # a primeira conta cadastrada e administradora


@pytest.fixture
def pessoa(client, admin):
    return _headers(client, "pessoa@example.com")


@pytest.fixture
def relatorio(db_session):
    colecao = Workspace(name="Comercial", slug="comercial")
    conexao = PowerBIConnection(name="Conta", tenant_id="t", client_id="c", client_secret="s")
    db_session.add_all([colecao, conexao])
    db_session.commit()
    rel = Report(
        collection_id=colecao.id,
        name="Custo Assistencial",
        powerbi_connection_id=conexao.id,
        pbi_workspace_id="ws",
        pbi_report_id="rep",
        pbi_dataset_id="ds",
    )
    db_session.add(rel)
    db_session.commit()
    return rel


def _dar_gerenciar_ia(client, admin, email="pessoa@example.com"):
    grupo = client.post("/groups/", json={"name": "Dados"}, headers=admin).json()["id"]
    client.post(f"/groups/{grupo}/members", json={"email": email}, headers=admin)
    client.put(f"/groups/{grupo}/permissions", json={"permissions": ["ia.gerenciar"]}, headers=admin)


def _elegivel():
    return patch.object(chat_dataset, "check_eligibility", return_value=Eligibility(True, None))


def _com_esquema(esquema=ESQUEMA):
    return patch.object(chat_dataset, "get_dataset_schema", return_value=esquema)


def _schema(client, headers, relatorio_id, refresh=False):
    return client.get(f"/ai/reports/{relatorio_id}/schema", params={"refresh": refresh}, headers=headers)


class TestPermissao:
    @pytest.mark.parametrize("caminho", ["schema", "settings"])
    def test_exige_estar_logado(self, client, relatorio, caminho):
        assert client.get(f"/ai/reports/{relatorio.id}/{caminho}").status_code == 401

    def test_quem_so_usa_o_chat_nao_ve_nem_muda(self, client, admin, pessoa, relatorio, db_session):
        ensure_default_group_access(db_session, relatorio.collection_id)
        grupo = client.post("/groups/", json={"name": "Usuarios"}, headers=admin).json()["id"]
        client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=admin)
        client.put(f"/groups/{grupo}/permissions", json={"permissions": ["ia.usar"]}, headers=admin)

        assert _schema(client, pessoa, relatorio.id).status_code == 403
        assert client.get(f"/ai/reports/{relatorio.id}/settings", headers=pessoa).status_code == 403
        assert client.put(f"/ai/reports/{relatorio.id}/settings", json={}, headers=pessoa).status_code == 403

    def test_quem_gerencia_a_ia_mas_nao_ve_a_colecao_recebe_404(self, client, admin, pessoa, relatorio):
        _dar_gerenciar_ia(client, admin)

        with patch.object(chat_dataset, "check_eligibility") as checar:
            assert _schema(client, pessoa, relatorio.id).status_code == 404
        assert client.get(f"/ai/reports/{relatorio.id}/settings", headers=pessoa).status_code == 404
        assert client.put(f"/ai/reports/{relatorio.id}/settings", json={}, headers=pessoa).status_code == 404
        checar.assert_not_called()

    def test_quem_gerencia_a_ia_e_ve_a_colecao_consegue(self, client, admin, pessoa, relatorio, db_session):
        ensure_default_group_access(db_session, relatorio.collection_id)
        _dar_gerenciar_ia(client, admin)

        with _elegivel(), _com_esquema():
            assert _schema(client, pessoa, relatorio.id).status_code == 200
        assert client.get(f"/ai/reports/{relatorio.id}/settings", headers=pessoa).status_code == 200

    def test_relatorio_inexistente_e_404(self, client, admin):
        assert _schema(client, admin, 9999).status_code == 404
        assert client.get("/ai/reports/9999/settings", headers=admin).status_code == 404


class TestSchema:
    def test_traz_tabelas_colunas_com_contagem_medidas_e_ocultas(self, client, admin, relatorio):
        with _elegivel(), _com_esquema():
            corpo = _schema(client, admin, relatorio.id).json()

        assert corpo["eligible"] is True and corpo["reason"] is None
        assert corpo["hidden_columns"] == 3 and corpo["omitted_tables"] == [] and corpo["omitted_columns"] == 0
        assert 0 < corpo["prompt_chars"] <= corpo["prompt_max_chars"]
        fato, dim = corpo["tables"]
        assert fato["name"] == "fato" and fato["measures"] == ["Custo"] and fato["in_prompt"] is True
        assert fato["columns"][0] == {"name": "unidade", "data_type": "texto", "distinct": 1377, "blocked": False}
        assert dim["columns"][0]["distinct"] == 5

    def test_marca_as_colunas_bloqueadas(self, client, admin, relatorio, db_session):
        ai_report_settings.save_settings(db_session, relatorio.id, "", [("FATO", "Unidade")], False)

        with _elegivel(), _com_esquema():
            corpo = _schema(client, admin, relatorio.id).json()

        assert [c["blocked"] for c in corpo["tables"][0]["columns"]] == [True, False]

    def test_tabela_que_nao_coube_aparece_como_fora_do_esquema(self, client, admin, relatorio):
        grande = SchemaTable("grande", tuple(SchemaColumn(f"coluna_{i}", None) for i in range(80)), ())
        esquema = DatasetSchema(tables=(ESQUEMA.tables[1], grande, ESQUEMA.tables[0]))

        with _elegivel(), _com_esquema(esquema), patch.object(chat_dataset, "MAX_SCHEMA_CHARS", 400):
            corpo = _schema(client, admin, relatorio.id).json()

        por_nome = {t["name"]: t["in_prompt"] for t in corpo["tables"]}
        assert por_nome == {"dim_unidade": True, "grande": False, "fato": True}
        assert corpo["omitted_tables"] == ["grande"] and corpo["prompt_max_chars"] == 400

    def test_relatorio_com_rls_vem_bloqueado_sem_ler_o_esquema(self, client, admin, relatorio):
        bloqueio = Eligibility(False, chat_dataset.REASON_RLS)

        with patch.object(chat_dataset, "check_eligibility", return_value=bloqueio), patch.object(
            chat_dataset, "get_dataset_schema"
        ) as ler:
            corpo = _schema(client, admin, relatorio.id).json()

        assert corpo["eligible"] is False and "seguranca por linha" in corpo["reason"] and corpo["tables"] is None
        ler.assert_not_called()

    def test_relatorio_sem_conta_do_power_bi(self, client, admin, relatorio, db_session):
        relatorio.powerbi_connection_id = None
        db_session.commit()

        corpo = _schema(client, admin, relatorio.id).json()

        assert corpo["eligible"] is False and "conta do Power BI" in corpo["reason"]

    def test_atualizar_esquece_o_cache_antes_de_ler(self, client, admin, relatorio):
        with _elegivel(), _com_esquema(), patch.object(chat_dataset, "clear_schema_cache") as limpar:
            _schema(client, admin, relatorio.id)
            limpar.assert_not_called()
            _schema(client, admin, relatorio.id, refresh=True)
            limpar.assert_called_once()

    def test_esquema_ilegivel_vira_502_com_o_motivo(self, client, admin, relatorio):
        with _elegivel(), patch.object(chat_dataset, "get_dataset_schema", side_effect=ChatDataError("sem tabelas")):
            resp = _schema(client, admin, relatorio.id)

        assert resp.status_code == 502 and resp.json()["detail"] == "sem tabelas"


class TestConfiguracoes:
    def _put(self, client, headers, relatorio_id, **corpo):
        return client.put(f"/ai/reports/{relatorio_id}/settings", json=corpo, headers=headers)

    def test_comeca_vazio_e_sem_imagem(self, client, admin, relatorio):
        corpo = client.get(f"/ai/reports/{relatorio.id}/settings", headers=admin).json()

        assert corpo == {
            "report_id": relatorio.id,
            "report_name": "Custo Assistencial",
            "notes": "",
            "blocked_columns": [],
            "allow_images": False,
        }

    def test_grava_e_devolve_orientacoes_colunas_e_imagem(self, client, admin, relatorio):
        resp = self._put(
            client,
            admin,
            relatorio.id,
            notes="  unidade e o estado, em dim_unidade[uf]  ",
            blocked_columns=[{"table": "fato", "column": "unidade"}],
            allow_images=True,
        )

        assert resp.status_code == 200
        lido = client.get(f"/ai/reports/{relatorio.id}/settings", headers=admin).json()
        assert lido["notes"] == "unidade e o estado, em dim_unidade[uf]"
        assert lido["blocked_columns"] == [{"table": "fato", "column": "unidade"}] and lido["allow_images"] is True

    def test_gravar_de_novo_troca_tudo_e_mantem_uma_linha_so(self, client, admin, relatorio, db_session):
        self._put(client, admin, relatorio.id, notes="a", allow_images=True)
        self._put(client, admin, relatorio.id, notes="", blocked_columns=[])

        lido = client.get(f"/ai/reports/{relatorio.id}/settings", headers=admin).json()
        assert (lido["notes"], lido["blocked_columns"], lido["allow_images"]) == ("", [], False)
        assert db_session.query(AIReportSettings).filter_by(report_id=relatorio.id).count() == 1

    def test_coluna_repetida_conta_uma_vez(self, client, admin, relatorio):
        repetidas = [{"table": "fato", "column": "unidade"}, {"table": "FATO", "column": "UNIDADE"}]

        lido = self._put(client, admin, relatorio.id, blocked_columns=repetidas).json()

        assert lido["blocked_columns"] == [{"table": "fato", "column": "unidade"}]

    def test_recusa_orientacao_grande_demais_e_nome_vazio(self, client, admin, relatorio):
        assert self._put(client, admin, relatorio.id, notes="x" * 2001).status_code == 422
        assert self._put(client, admin, relatorio.id, blocked_columns=[{"table": " ", "column": "a"}]).status_code == 422
        assert self._put(client, admin, relatorio.id, blocked_columns=[{"table": "t", "column": ""}]).status_code == 422
        muitas = [{"table": "t", "column": f"c{i}"} for i in range(301)]
        assert self._put(client, admin, relatorio.id, blocked_columns=muitas).status_code == 422

    def test_auditoria_guarda_so_os_numeros(self, client, admin, relatorio, db_session):
        self._put(
            client,
            admin,
            relatorio.id,
            notes="segredo da orientacao",
            blocked_columns=[{"table": "tabela_secreta", "column": "coluna_secreta"}],
        )

        linha = db_session.query(AuditLog).filter_by(action="update_ai_report_settings").one()
        assert linha.details == "orientacoes=21 caracteres; colunas bloqueadas=1; imagens=nao"
        assert "secret" not in (linha.details or "")

    def test_apagar_o_relatorio_apaga_as_configuracoes(self, client, admin, relatorio, db_session):
        self._put(client, admin, relatorio.id, notes="a")
        assert db_session.query(AIReportSettings).count() == 1

        resp = client.delete(f"/workspaces/{relatorio.collection_id}/reports/{relatorio.id}", headers=admin)

        assert resp.status_code == 204
        assert db_session.query(AIReportSettings).count() == 0

    def test_apagar_a_colecao_apaga_as_configuracoes_dos_relatorios(self, client, admin, relatorio, db_session):
        self._put(client, admin, relatorio.id, notes="a")

        resp = client.delete(f"/workspaces/{relatorio.collection_id}", headers=admin)

        assert resp.status_code == 204
        assert db_session.query(AIReportSettings).count() == 0


class TestAquecerImagem:
    def _post(self, client, headers, relatorio_id, pagina="ReportSection1"):
        return client.post(f"/ai/reports/{relatorio_id}/page-image", json={"page_name": pagina}, headers=headers)

    def _liberar_usar(self, client, admin, email="pessoa@example.com"):
        grupo = client.post("/groups/", json={"name": "Analistas"}, headers=admin).json()["id"]
        client.post(f"/groups/{grupo}/members", json={"email": email}, headers=admin)
        client.put(f"/groups/{grupo}/permissions", json={"permissions": ["ia.usar"]}, headers=admin)

    def test_exige_estar_logado(self, client, relatorio):
        resp = client.post(f"/ai/reports/{relatorio.id}/page-image", json={"page_name": "P1"})

        assert resp.status_code == 401

    def test_quem_nao_pode_usar_o_chat_recebe_403(self, client, admin, pessoa, relatorio):
        assert self._post(client, pessoa, relatorio.id).status_code == 403

    def test_quem_usa_o_chat_mas_nao_ve_a_colecao_recebe_404(self, client, admin, pessoa, relatorio):
        self._liberar_usar(client, admin)

        assert self._post(client, pessoa, relatorio.id).status_code == 404

    def test_quem_so_usa_o_chat_pode_pedir_mas_sem_liberacao_nada_acontece(self, client, admin, pessoa, relatorio, db_session):
        ensure_default_group_access(db_session, relatorio.collection_id)
        self._liberar_usar(client, admin)

        with patch.object(chat_images, "warm") as aquecer:
            resp = self._post(client, pessoa, relatorio.id)

        assert resp.status_code == 200 and resp.json() == {"state": "disabled"}
        aquecer.assert_not_called()

    def test_liberado_pelo_admin_pede_a_imagem_e_devolve_o_estado(self, client, admin, relatorio, db_session):
        ai_report_settings.save_settings(db_session, relatorio.id, "", [], True)

        with _elegivel(), patch.object(chat_images, "warm", return_value="warming") as aquecer:
            resp = self._post(client, admin, relatorio.id, "ReportSection9")

        assert resp.json() == {"state": "warming"}
        assert aquecer.call_args.args[2] == "ReportSection9"

    def test_relatorio_com_rls_nunca_exporta(self, client, admin, relatorio, db_session):
        ai_report_settings.save_settings(db_session, relatorio.id, "", [], True)
        bloqueio = Eligibility(False, chat_dataset.REASON_RLS)

        with patch.object(chat_dataset, "check_eligibility", return_value=bloqueio), patch.object(chat_images, "warm") as aquecer:
            resp = self._post(client, admin, relatorio.id)

        assert resp.json() == {"state": "disabled"}
        aquecer.assert_not_called()

    @pytest.mark.parametrize("pagina", ["", "../etc", "pagina com espaco", "x" * 101])
    def test_nome_de_pagina_fora_do_formato_e_recusado(self, client, admin, relatorio, pagina):
        assert self._post(client, admin, relatorio.id, pagina).status_code == 422

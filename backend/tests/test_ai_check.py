"""Diagnostico de relatorio para o chat: quem pode chamar, o que devolve (so contagens e motivo,
nunca dado) e como trata RLS."""

from unittest.mock import patch

import pytest

from app.core import chat_dataset
from app.core.chat_dataset import ChatDataError, DatasetSchema, Eligibility, SchemaColumn, SchemaTable
from app.core.workspace_deps import ensure_default_group_access
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.workspace import Workspace

PASSWORD = "SenhaForte123"

ESQUEMA = DatasetSchema(
    tables=(
        SchemaTable("Vendas", (SchemaColumn("Valor", "decimal"), SchemaColumn("Cliente", "texto")), (("Total", None),)),
        SchemaTable("Clientes", (SchemaColumn("Nome", "texto"),), ()),
    )
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
        name="Vendas do mes",
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


def _check(client, headers, relatorio_id):
    return client.get(f"/ai/reports/{relatorio_id}/check", headers=headers)


class TestPermissao:
    def test_exige_estar_logado(self, client, relatorio):
        assert _check(client, {}, relatorio.id).status_code == 401

    def test_quem_so_usa_o_chat_nao_diagnostica(self, client, admin, pessoa, relatorio, db_session):
        ensure_default_group_access(db_session, relatorio.collection_id)
        grupo = client.post("/groups/", json={"name": "Usuarios"}, headers=admin).json()["id"]
        client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=admin)
        client.put(f"/groups/{grupo}/permissions", json={"permissions": ["ia.usar"]}, headers=admin)

        assert _check(client, pessoa, relatorio.id).status_code == 403

    def test_quem_gerencia_a_ia_mas_nao_ve_a_colecao_recebe_404(self, client, admin, pessoa, relatorio):
        _dar_gerenciar_ia(client, admin)

        with patch.object(chat_dataset, "check_eligibility") as checar:
            resp = _check(client, pessoa, relatorio.id)

        assert resp.status_code == 404
        checar.assert_not_called()

    def test_quem_gerencia_a_ia_e_ve_a_colecao_diagnostica(self, client, admin, pessoa, relatorio, db_session):
        ensure_default_group_access(db_session, relatorio.collection_id)
        _dar_gerenciar_ia(client, admin)

        with patch.object(chat_dataset, "check_eligibility", return_value=Eligibility(True, None)), patch.object(
            chat_dataset, "get_dataset_schema", return_value=ESQUEMA
        ):
            resp = _check(client, pessoa, relatorio.id)

        assert resp.status_code == 200 and resp.json()["eligible"] is True

    def test_relatorio_inexistente_e_404(self, client, admin):
        assert _check(client, admin, 9999).status_code == 404


class TestResposta:
    def test_elegivel_traz_so_contagens(self, client, admin, relatorio):
        with patch.object(chat_dataset, "check_eligibility", return_value=Eligibility(True, None)), patch.object(
            chat_dataset, "get_dataset_schema", return_value=ESQUEMA
        ):
            resp = _check(client, admin, relatorio.id)

        corpo = resp.json()
        assert corpo["report_id"] == relatorio.id and corpo["report_name"] == "Vendas do mes"
        assert (corpo["eligible"], corpo["reason"]) == (True, None)
        assert (corpo["tables"], corpo["columns"], corpo["measures"]) == (2, 3, 1)
        assert corpo["latency_ms"] >= 0

    def test_nunca_devolve_nomes_de_tabela_coluna_ou_medida(self, client, admin, relatorio):
        with patch.object(chat_dataset, "check_eligibility", return_value=Eligibility(True, None)), patch.object(
            chat_dataset, "get_dataset_schema", return_value=ESQUEMA
        ):
            texto = _check(client, admin, relatorio.id).text

        for nome in ("Valor", "Cliente", "Clientes", "Nome", "Total"):
            assert nome not in texto.replace("Vendas do mes", "")

    def test_relatorio_com_rls_vem_bloqueado_com_o_motivo_e_sem_ler_o_esquema(self, client, admin, relatorio):
        bloqueio = Eligibility(False, chat_dataset.REASON_RLS)

        with patch.object(chat_dataset, "check_eligibility", return_value=bloqueio), patch.object(
            chat_dataset, "get_dataset_schema"
        ) as esquema:
            corpo = _check(client, admin, relatorio.id).json()

        assert corpo["eligible"] is False and "seguranca por linha" in corpo["reason"]
        assert (corpo["tables"], corpo["columns"], corpo["measures"]) == (None, None, None)
        esquema.assert_not_called()

    def test_relatorio_sem_conta_do_power_bi(self, client, admin, relatorio, db_session):
        relatorio.powerbi_connection_id = None
        db_session.commit()

        with patch.object(chat_dataset, "check_eligibility") as checar:
            corpo = _check(client, admin, relatorio.id).json()

        assert corpo["eligible"] is False and "conta do Power BI" in corpo["reason"]
        checar.assert_not_called()

    def test_falha_ao_ler_o_esquema_vira_502(self, client, admin, relatorio):
        with patch.object(chat_dataset, "check_eligibility", return_value=Eligibility(True, None)), patch.object(
            chat_dataset, "get_dataset_schema", side_effect=ChatDataError("Nao foi possivel ler tabelas e colunas visiveis.")
        ):
            resp = _check(client, admin, relatorio.id)

        assert resp.status_code == 502
        assert "tabelas e colunas" in resp.json()["detail"]

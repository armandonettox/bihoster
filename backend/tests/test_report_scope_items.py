"""v1.53.0: assinaturas e alertas com permissao POR RELATORIO e horario de acesso por relatorio. Dados ficticios; o Power BI
nunca e chamado (o que passa pela permissao so chega a erros de "sem conta" ou a gravar no banco)."""

from datetime import datetime, timezone

import pytest

from app.core import report_schedule
from app.models.alert import ReportAlert
from app.models.report import Report
from app.models.report_schedule import ReportScheduleRange
from app.models.subscription import ReportSubscription
from app.models.user import User
from tests.test_report_access import _dar, cena  # noqa: F401  (cena e fixture)

ALERTA = {
    "name": "Meta", "measure_name": "Total", "condition": ">", "threshold": 10, "recipients": ["gestor@example.com"],
}
TUDO_DE_ALERTA = ["alerta.ver", "alerta.criar", "alerta.editar", "alerta.excluir"]
TUDO_DE_ASSINATURA = ["assinatura.ver", "assinatura.editar", "assinatura.excluir", "assinatura.executar"]


def _url_alertas(rel):
    return f"/workspaces/{rel.collection_id}/reports/{rel.id}/alerts"


def _url_alerta(rel, alerta_id):
    return f"/workspaces/{rel.collection_id}/alerts/{alerta_id}"


def _criar_alerta(db_session, rel, dono_email=None):
    dono = db_session.query(User).filter(User.email == dono_email).first() if dono_email else None
    alerta = ReportAlert(
        report_id=rel.id, created_by_id=dono.id if dono else None, created_by_name=dono.name if dono else None,
        name="Meta", measure_name="Total", condition=">", threshold=10.0, check_interval_minutes=60, cooldown_hours=24, enabled=True,
    )
    alerta.recipients = ["gestor@example.com"]
    db_session.add(alerta)
    db_session.commit()
    return alerta.id


def _criar_assinatura(db_session, rel, dono_email=None):
    dono = db_session.query(User).filter(User.email == dono_email).first() if dono_email else None
    sub = ReportSubscription(
        report_id=rel.id, created_by_id=dono.id if dono else None, created_by_name=dono.name if dono else None,
        name="Semanal", fmt="PDF", timezone="America/Sao_Paulo", enabled=False, consecutive_failures=0,
    )
    sub.recipients, sub.days, sub.times = ["gestor@example.com"], [0], ["08:00"]
    db_session.add(sub)
    db_session.commit()
    return sub.id


class TestAlertasPorRelatorio:
    def test_o_item_dado_num_relatorio_vale_nele_e_nao_no_vizinho_da_mesma_pasta(self, client, cena):
        _dar(client, cena, cena["a"], "ana", TUDO_DE_ALERTA)

        assert client.get(_url_alertas(cena["a"]), headers=cena["ana"]).status_code == 200
        assert client.post(_url_alertas(cena["a"]), json=ALERTA, headers=cena["ana"]).status_code == 201
        assert client.get(_url_alertas(cena["b"]), headers=cena["ana"]).status_code == 403
        assert client.post(_url_alertas(cena["b"]), json=ALERTA, headers=cena["ana"]).status_code == 403

    def test_sem_nada_no_relatorio_recusa(self, client, cena):
        assert client.get(_url_alertas(cena["a"]), headers=cena["beto"]).status_code == 403
        assert client.post(_url_alertas(cena["a"]), json=ALERTA, headers=cena["beto"]).status_code == 403

    def test_o_proprio_item_edita_e_exclui_o_dos_outros_nao(self, client, cena, db_session):
        _dar(client, cena, cena["a"], "ana", TUDO_DE_ALERTA)
        dela = _criar_alerta(db_session, cena["a"], "ana@example.com")
        de_outro = _criar_alerta(db_session, cena["a"], "beto@example.com")

        assert client.put(_url_alerta(cena["a"], dela), json={"name": "Novo"}, headers=cena["ana"]).status_code == 200
        assert client.put(_url_alerta(cena["a"], de_outro), json={"name": "Novo"}, headers=cena["ana"]).status_code == 403
        assert client.delete(_url_alerta(cena["a"], de_outro), headers=cena["ana"]).status_code == 403
        assert client.delete(_url_alerta(cena["a"], dela), headers=cena["ana"]).status_code == 204

    def test_o_item_outras_no_relatorio_libera_o_de_outras_pessoas_so_ali(self, client, cena, db_session):
        _dar(client, cena, cena["a"], "ana", TUDO_DE_ALERTA + ["alerta.ver-outras", "alerta.editar-outras", "alerta.excluir-outras"])
        no_a = _criar_alerta(db_session, cena["a"], "beto@example.com")
        no_b = _criar_alerta(db_session, cena["b"], "beto@example.com")

        assert client.put(_url_alerta(cena["a"], no_a), json={"name": "Novo"}, headers=cena["ana"]).status_code == 200
        assert client.put(_url_alerta(cena["b"], no_b), json={"name": "Novo"}, headers=cena["ana"]).status_code == 403

    def test_a_lista_do_relatorio_mostra_so_os_proprios_sem_o_item_outras(self, client, cena, db_session):
        _dar(client, cena, cena["a"], "ana", ["alerta.ver"])
        _criar_alerta(db_session, cena["a"], "ana@example.com")
        _criar_alerta(db_session, cena["a"], "beto@example.com")

        lista = client.get(_url_alertas(cena["a"]), headers=cena["ana"]).json()

        assert len(lista) == 1 and lista[0]["created_by_id"] == cena["ana_id"]

    def test_alerta_que_nao_existe_ou_de_relatorio_sem_acesso_responde_igual(self, client, cena, db_session):
        no_b = _criar_alerta(db_session, cena["b"])
        _dar(client, cena, cena["a"], "ana", TUDO_DE_ALERTA)

        assert client.put(_url_alerta(cena["a"], no_b), json={"name": "X"}, headers=cena["ana"]).status_code == 403
        assert client.put(_url_alerta(cena["a"], 9999), json={"name": "X"}, headers=cena["ana"]).status_code == 403

    def test_a_pasta_continua_valendo_para_todos_os_relatorios_dela(self, client, cena):
        # Quem tem o item na pasta (sem nenhuma linha por relatorio) segue podendo em qualquer relatorio dela
        r = client.put(
            f"/access/users/{cena['caio_id']}",
            json={"blocks": [{"workspace_id": cena["financeiro"].id, "permissions": ["colecao.ver"] + TUDO_DE_ALERTA}]},
            headers=cena["admin"],
        )
        assert r.status_code == 200, r.text

        assert client.get(_url_alertas(cena["a"]), headers=cena["caio"]).status_code == 200
        assert client.get(_url_alertas(cena["b"]), headers=cena["caio"]).status_code == 200
        assert client.get(_url_alertas(cena["c"]), headers=cena["caio"]).status_code == 403

    def test_a_lista_de_relatorios_para_criar_traz_so_os_que_a_pessoa_pode(self, client, cena, db_session):
        # alerta.todas (global) so abre a tela; quem aparece para criar e o relatorio em que ela tem alerta.criar
        uid = cena["ana_id"]
        r = client.put(f"/access/users/{uid}", json={"blocks": [{"workspace_id": None, "permissions": ["alerta.todas"]}]}, headers=cena["admin"])
        assert r.status_code == 200, r.text
        _dar(client, cena, cena["b"], "ana", ["alerta.ver", "alerta.criar"])

        lista = client.get("/alerts/reports", headers=cena["ana"]).json()

        assert [item["report_id"] for item in lista] == [cena["b"].id]


class TestAssinaturasPorRelatorio:
    def test_ver_e_listar_valem_no_relatorio_dado_e_nao_no_vizinho(self, client, cena):
        _dar(client, cena, cena["a"], "ana", ["assinatura.ver"])

        base = "/workspaces/{}/reports/{}/subscriptions"
        assert client.get(base.format(cena["a"].collection_id, cena["a"].id), headers=cena["ana"]).status_code == 200
        assert client.get(base.format(cena["b"].collection_id, cena["b"].id), headers=cena["ana"]).status_code == 403

    def test_excluir_so_a_propria_e_so_no_relatorio_dado(self, client, cena, db_session):
        _dar(client, cena, cena["a"], "ana", TUDO_DE_ASSINATURA)
        dela = _criar_assinatura(db_session, cena["a"], "ana@example.com")
        de_outro = _criar_assinatura(db_session, cena["a"], "beto@example.com")
        no_b = _criar_assinatura(db_session, cena["b"], "ana@example.com")
        base = f"/workspaces/{cena['a'].collection_id}/subscriptions"

        assert client.delete(f"{base}/{de_outro}", headers=cena["ana"]).status_code == 403
        assert client.delete(f"{base}/{no_b}", headers=cena["ana"]).status_code == 403
        assert client.delete(f"{base}/{dela}", headers=cena["ana"]).status_code == 204

    def test_sem_o_item_de_excluir_recusa_mesmo_sendo_a_propria(self, client, cena, db_session):
        _dar(client, cena, cena["a"], "ana", ["assinatura.ver"])
        dela = _criar_assinatura(db_session, cena["a"], "ana@example.com")

        resp = client.delete(f"/workspaces/{cena['a'].collection_id}/subscriptions/{dela}", headers=cena["ana"])

        assert resp.status_code == 403

    def test_as_flags_da_lista_seguem_o_relatorio(self, client, cena, db_session):
        _dar(client, cena, cena["a"], "ana", ["assinatura.ver", "assinatura.editar"])
        _criar_assinatura(db_session, cena["a"], "ana@example.com")

        lista = client.get(f"/workspaces/{cena['a'].collection_id}/reports/{cena['a'].id}/subscriptions", headers=cena["ana"]).json()

        assert lista[0]["can_edit"] is True and lista[0]["can_delete"] is False and lista[0]["can_run"] is False

    def test_a_visao_do_portal_so_oferece_relatorio_com_o_item_de_criar(self, client, cena):
        client.put(f"/access/users/{cena['ana_id']}", json={"blocks": [{"workspace_id": None, "permissions": ["assinatura.todas"]}]}, headers=cena["admin"])
        _dar(client, cena, cena["a"], "ana", ["assinatura.ver", "assinatura.criar"])

        lista = client.get("/subscriptions/reports", headers=cena["ana"]).json()

        assert [item["report_id"] for item in lista] == [cena["a"].id]


def _faixa(db_session, rel, dias="0,1,2,3,4", inicio=8 * 60, fim=18 * 60):
    db_session.add(ReportScheduleRange(report_id=rel.id, days=dias, start_minute=inicio, end_minute=fim))
    db_session.commit()


@pytest.fixture
def relogio(monkeypatch):
    """Fixa o relogio dos horarios (UTC) e devolve a funcao para trocar o instante. Fuso do sistema: America/Sao_Paulo (UTC-3)."""
    estado = {"agora": datetime(2026, 11, 25, 15, 0, tzinfo=timezone.utc)}  # quarta, 12:00 em Sao Paulo
    monkeypatch.setattr("app.core.access_schedule._now", lambda: estado["agora"])

    def fixar(ano, mes, dia, hora_utc, minuto=0):
        estado["agora"] = datetime(ano, mes, dia, hora_utc, minuto, tzinfo=timezone.utc)

    return fixar


class TestHorarioPorRelatorio:
    def _embed(self, client, cena, rel, quem):
        return client.get(f"/workspaces/{rel.collection_id}/powerbi/reports/{rel.id}/embed", headers=cena[quem])

    def test_sem_faixa_nenhuma_nao_ha_limite(self, client, cena, relogio):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])

        assert self._embed(client, cena, cena["a"], "ana").status_code != 403

    def test_dentro_da_faixa_abre_e_fora_dela_recusa_com_o_horario(self, client, cena, db_session, relogio):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])
        _faixa(db_session, cena["a"])  # seg a sex, 08:00 as 18:00

        assert self._embed(client, cena, cena["a"], "ana").status_code != 403  # quarta, 12:00
        relogio(2026, 11, 25, 23)  # quarta, 20:00 em Sao Paulo
        resp = self._embed(client, cena, cena["a"], "ana")

        assert resp.status_code == 403
        detalhe = resp.json()["detail"]
        assert detalhe["code"] == "report_outside_hours"
        assert detalhe["windows"] and detalhe["next_open"]

    def test_o_horario_e_so_daquele_relatorio(self, client, cena, db_session, relogio):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])
        _dar(client, cena, cena["b"], "ana", ["relatorio.ver"])
        _faixa(db_session, cena["a"])
        relogio(2026, 11, 25, 23)

        assert self._embed(client, cena, cena["a"], "ana").status_code == 403
        assert self._embed(client, cena, cena["b"], "ana").status_code != 403

    def test_o_administrador_nunca_e_limitado(self, client, cena, db_session, relogio):
        _faixa(db_session, cena["a"])
        relogio(2026, 11, 29, 23)  # domingo a noite

        assert self._embed(client, cena, cena["a"], "admin").status_code != 403

    def test_exportar_tambem_respeita_o_horario(self, client, cena, db_session, relogio):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver", "relatorio.exportar"])
        _faixa(db_session, cena["a"])
        relogio(2026, 11, 29, 23)

        url = f"/workspaces/{cena['a'].collection_id}/powerbi/reports/{cena['a'].id}/export-download"
        resp = client.post(url, json={"format": "PDF"}, headers=cena["ana"])

        assert resp.status_code == 403 and resp.json()["detail"]["code"] == "report_outside_hours"

    def test_a_faixa_que_vira_a_madrugada(self, client, cena, db_session, relogio):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver"])
        _faixa(db_session, cena["a"], dias="0,1,2,3,4,5,6", inicio=22 * 60, fim=6 * 60)

        relogio(2026, 11, 26, 3)  # quarta 00:00 em Sao Paulo: dentro
        assert self._embed(client, cena, cena["a"], "ana").status_code != 403
        relogio(2026, 11, 26, 15)  # quinta 12:00: fora
        assert self._embed(client, cena, cena["a"], "ana").status_code == 403

    def test_liberacao_temporaria_aprovada_abre_ate_o_prazo(self, db_session, cena, relogio):
        from app.models.access_extension import STATUS_APPROVED, AccessExtensionRequest

        _faixa(db_session, cena["a"])
        relogio(2026, 11, 25, 23)
        ana = db_session.query(User).filter(User.email == "ana@example.com").first()
        assert not report_schedule.evaluate_report_schedule(db_session, ana, cena["a"].id).allowed

        db_session.add(AccessExtensionRequest(
            user_id=ana.id, status=STATUS_APPROVED, grant_until=datetime(2026, 11, 26, 2, 0, tzinfo=timezone.utc), reason="teste",
        ))
        db_session.commit()

        assert report_schedule.evaluate_report_schedule(db_session, ana, cena["a"].id).allowed

    def test_gerenciar_o_relatorio_nao_depende_do_horario(self, client, cena, db_session, relogio):
        _dar(client, cena, cena["a"], "ana", ["relatorio.ver", "relatorio.compartilhar"])
        _faixa(db_session, cena["a"])
        relogio(2026, 11, 29, 23)

        # Nao e abrir nem exportar: o painel de quem tem acesso segue respondendo
        assert client.get(f"/access-panel/report/{cena['a'].id}", headers=cena["ana"]).status_code == 200


class TestRotasDoHorarioDoRelatorio:
    def test_define_le_e_zera_as_faixas_com_auditoria(self, client, cena, db_session):
        corpo = {"ranges": [{"days": [0, 1, 2], "start": "08:00", "end": "18:00"}]}

        salvo = client.put(f"/access-schedules/reports/{cena['a'].id}", json=corpo, headers=cena["admin"])
        lido = client.get(f"/access-schedules/reports/{cena['a'].id}", headers=cena["admin"])

        assert salvo.status_code == 200 and lido.json()["ranges"] == corpo["ranges"]
        client.put(f"/access-schedules/reports/{cena['a'].id}", json={"ranges": []}, headers=cena["admin"])
        assert client.get(f"/access-schedules/reports/{cena['a'].id}", headers=cena["admin"]).json()["ranges"] == []
        from app.models.audit_log import AuditLog

        assert db_session.query(AuditLog).filter(AuditLog.action == "set_report_schedule").count() == 2

    def test_exige_a_permissao_de_horario_e_valida_o_formato(self, client, cena):
        corpo = {"ranges": [{"days": [0], "start": "08:00", "end": "18:00"}]}

        assert client.put(f"/access-schedules/reports/{cena['a'].id}", json=corpo, headers=cena["ana"]).status_code == 403
        assert client.get(f"/access-schedules/reports/{cena['a'].id}", headers=cena["ana"]).status_code == 403
        ruim = {"ranges": [{"days": [], "start": "08:00", "end": "18:00"}]}
        assert client.put(f"/access-schedules/reports/{cena['a'].id}", json=ruim, headers=cena["admin"]).status_code == 400
        assert client.put("/access-schedules/reports/9999", json=corpo, headers=cena["admin"]).status_code == 404

    def test_excluir_o_relatorio_apaga_as_faixas(self, client, cena, db_session):
        _faixa(db_session, cena["a"])

        resp = client.delete(f"/workspaces/{cena['a'].collection_id}/reports/{cena['a'].id}", headers=cena["admin"])

        assert resp.status_code == 204
        assert db_session.query(ReportScheduleRange).filter(ReportScheduleRange.report_id == cena["a"].id).count() == 0
        assert db_session.query(Report).filter(Report.id == cena["a"].id).count() == 0

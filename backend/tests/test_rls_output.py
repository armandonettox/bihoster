"""v1.55.0: saida de relatorio com RLS (e-mail, exportacao em arquivo e Modo TV). O Power BI e o SMTP sao sempre simulados e os
dados sao ficticios. O que mais importa: com a chave geral desligada nada muda; ligada, a identidade e a de quem RECEBE (nunca a
de quem criou), e sem funcao mapeada nada sai (falha fechada)."""

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.core import powerbi as powerbi_core
from app.core import report_delivery, rls_output, subscription_runner
from app.models.audit_log import AuditLog
from app.models.catalog_sync import DatasetRoleGrant, PbiDataset
from app.models.report import Report
from app.models.settings import AppSettings
from app.models.tv import Tv, TvItem
from app.models.user import User
from app.models.workspace import Group
from tests.test_dataset_security import _mapear, cena  # noqa: F401  (cena e fixture)
from tests.test_powerbi_cache_sharing import _token
from tests.test_subscription_runner import entrega, fabrica, limpa_estado, montar, pbi, recarregar, rodar  # noqa: F401


def _ligar(db_session, valor=True):
    linha = db_session.query(AppSettings).filter(AppSettings.id == 1).first() or AppSettings(id=1)
    linha.rls_output_enabled = valor
    db_session.add(linha)
    db_session.commit()


def _pbi_com_rls():
    return (
        patch.object(powerbi_core, "get_report_details", return_value={"embedUrl": "https://embed/x"}),
        patch.object(powerbi_core, "dataset_requires_effective_identity", return_value=True),
        patch.object(powerbi_core, "list_pages", return_value=[]),
    )


def _liberar_exportar(client, cena, db_session):
    padrao = db_session.query(Group).filter(Group.is_default.is_(True)).one()
    resposta = client.put(
        f"/access/groups/{padrao.id}",
        json={"blocks": [{"workspace_id": cena["workspace"]["id"], "permissions": ["colecao.ver", "relatorio.exportar"]}]},
        headers=cena["admin"],
    )
    assert resposta.status_code == 200, resposta.text


def _sincrono(monkeypatch):
    """Roda o trabalho em segundo plano na hora, para o teste ver o resultado."""
    monkeypatch.setattr(report_delivery, "start_download_in_background", lambda **kw: report_delivery.run_download(**kw))
    monkeypatch.setattr(report_delivery, "start_in_background", lambda **kw: report_delivery.run_delivery(**kw))


def _exportar(client, cena, quem, monkeypatch, *, formato="PDF"):
    _sincrono(monkeypatch)
    exportador = MagicMock(return_value=b"%PDF-falso")
    p1, p2, p3 = _pbi_com_rls()
    with p1, p2, p3, patch.object(powerbi_core, "export_report", exportador):
        url = f"/workspaces/{cena['workspace']['id']}/powerbi/reports/{cena['rel1']['id']}/export-download"
        resposta = client.post(url, json={"format": formato}, headers=cena[quem])
    return resposta, exportador


class TestChaveGeral:
    def test_vem_desligada_e_so_o_administrador_muda(self, client, cena):
        assert client.get("/settings/", headers=cena["admin"]).json()["rls_output_enabled"] is False

        assert client.put("/settings/", json={"rls_output_enabled": True}, headers=cena["ana"]).status_code == 403
        assert client.put("/settings/", json={"rls_output_enabled": True}, headers=cena["admin"]).json()["rls_output_enabled"] is True

    def test_desligada_o_relatorio_com_rls_nao_sai_em_arquivo(self, client, cena, db_session, monkeypatch):
        _liberar_exportar(client, cena, db_session)
        _mapear(db_session, cena["ds1"], ("u", cena["ana_u"], "Gerente"))

        resposta, exportador = _exportar(client, cena, "ana", monkeypatch)

        assert resposta.status_code == 400 and "Permitir saida de relatorio com RLS" in resposta.json()["detail"]
        exportador.assert_not_called()


class TestExportacaoEmArquivo:
    def test_sai_com_as_funcoes_de_quem_exporta_e_vai_para_a_auditoria(self, client, cena, db_session, monkeypatch):
        _ligar(db_session)
        _liberar_exportar(client, cena, db_session)
        _mapear(db_session, cena["ds1"], ("u", cena["ana_u"], "Gerente"), ("u", cena["beto_u"], "Vendedor"))

        resposta, exportador = _exportar(client, cena, "ana", monkeypatch)

        assert resposta.status_code == 202
        assert exportador.call_args.kwargs["identities"] == [{"username": "ana@example.com", "roles": ["Gerente"], "datasets": ["ds-1"]}]
        auditoria = db_session.query(AuditLog).filter(AuditLog.action == "rls_output_download").one()
        assert f"usuario {cena['ana_u'].id}: Gerente" in auditoria.details

    def test_cada_pessoa_exporta_com_a_propria_funcao(self, client, cena, db_session, monkeypatch):
        _ligar(db_session)
        _liberar_exportar(client, cena, db_session)
        _mapear(db_session, cena["ds1"], ("u", cena["ana_u"], "Gerente"), ("u", cena["beto_u"], "Vendedor"))

        _, do_beto = _exportar(client, cena, "beto", monkeypatch)

        assert do_beto.call_args.kwargs["identities"][0]["roles"] == ["Vendedor"]
        assert do_beto.call_args.kwargs["identities"][0]["username"] == "beto@example.com"

    def test_sem_funcao_nada_sai_falha_fechada(self, client, cena, db_session, monkeypatch):
        _ligar(db_session)
        _liberar_exportar(client, cena, db_session)
        _mapear(db_session, cena["ds1"], ("u", cena["ana_u"], "Gerente"))

        resposta, exportador = _exportar(client, cena, "caio", monkeypatch)

        assert resposta.status_code == 400 and "funcao de seguranca" in resposta.json()["detail"]
        exportador.assert_not_called()

    def test_modelo_sem_funcoes_mapeadas_tambem_nao_sai(self, client, cena, db_session, monkeypatch):
        _ligar(db_session)
        _liberar_exportar(client, cena, db_session)

        resposta, exportador = _exportar(client, cena, "ana", monkeypatch)

        assert resposta.status_code == 400 and "nao tem funcoes de seguranca mapeadas" in resposta.json()["detail"]
        exportador.assert_not_called()

    def test_relatorio_sem_rls_continua_igual_e_sem_identidade(self, client, cena, db_session, monkeypatch):
        _ligar(db_session)
        _liberar_exportar(client, cena, db_session)
        _sincrono(monkeypatch)
        exportador = MagicMock(return_value=b"%PDF-falso")
        with patch.object(powerbi_core, "get_report_details", return_value={"embedUrl": "x"}), patch.object(
            powerbi_core, "dataset_requires_effective_identity", return_value=False
        ), patch.object(powerbi_core, "list_pages", return_value=[]), patch.object(powerbi_core, "export_report", exportador):
            url = f"/workspaces/{cena['workspace']['id']}/powerbi/reports/{cena['rel1']['id']}/export-download"
            resposta = client.post(url, json={"format": "PDF"}, headers=cena["ana"])

        assert resposta.status_code == 202 and exportador.call_args.kwargs["identities"] is None

    def test_o_pedido_ao_power_bi_leva_as_identidades_no_formato_da_documentacao(self):
        enviado = {}

        class Resposta:
            status_code = 202

            @staticmethod
            def json():
                return {"id": "exp-1"}

        def post(url, headers=None, json=None):
            enviado.update(json)
            return Resposta()

        with patch.object(powerbi_core, "_http", MagicMock(post=post)), patch.object(powerbi_core, "_headers", return_value={}):
            powerbi_core.start_export(
                MagicMock(), "ws", "rel", "PDF", None, None, [{"username": "u@example.com", "roles": ["Gerente"], "datasets": ["ds-1"]}]
            )

        assert enviado["powerBIReportConfiguration"]["identities"] == [{"username": "u@example.com", "roles": ["Gerente"], "datasets": ["ds-1"]}]


class TestEnvioAvulsoPorEmail:
    def _preparar_email(self, client, cena):
        client.put(
            "/settings/email/",
            json={"smtp_host": "smtp.x", "smtp_from_email": "relatorios@example.com", "email_allowed_domains": "example.com"},
            headers=cena["admin"],
        )

    def _enviar(self, client, cena, monkeypatch, destinatario):
        _sincrono(monkeypatch)
        exportador = MagicMock(return_value=b"%PDF-falso")
        p1, p2, p3 = _pbi_com_rls()
        with p1, p2, p3, patch.object(powerbi_core, "export_report", exportador), patch.object(report_delivery, "send_email") as envio:
            url = f"/workspaces/{cena['workspace']['id']}/powerbi/reports/{cena['rel1']['id']}/export-email"
            resposta = client.post(url, json={"to": destinatario, "format": "PDF"}, headers=cena["admin"])
        return resposta, exportador, envio

    def test_o_arquivo_sai_com_a_identidade_do_destinatario_e_nao_a_de_quem_pediu(self, client, cena, db_session, monkeypatch):
        _ligar(db_session)
        self._preparar_email(client, cena)
        _mapear(db_session, cena["ds1"], ("u", cena["admin_u"], "Diretor"), ("u", cena["beto_u"], "Vendedor"))

        resposta, exportador, envio = self._enviar(client, cena, monkeypatch, "beto@example.com")

        assert resposta.status_code == 202
        assert exportador.call_args.kwargs["identities"] == [{"username": "beto@example.com", "roles": ["Vendedor"], "datasets": ["ds-1"]}]
        assert envio.call_args.args[1] == ["beto@example.com"]
        assert db_session.query(AuditLog).filter(AuditLog.action == "rls_output_email").count() == 1

    def test_destinatario_sem_conta_no_portal_nao_recebe(self, client, cena, db_session, monkeypatch):
        _ligar(db_session)
        self._preparar_email(client, cena)
        _mapear(db_session, cena["ds1"], ("u", cena["ana_u"], "Gerente"))

        resposta, exportador, envio = self._enviar(client, cena, monkeypatch, "estranho@example.com")

        assert resposta.status_code == 400 and "conta no portal" in resposta.json()["detail"]
        exportador.assert_not_called()
        envio.assert_not_called()

    def test_destinatario_sem_funcao_nao_recebe(self, client, cena, db_session, monkeypatch):
        _ligar(db_session)
        self._preparar_email(client, cena)
        _mapear(db_session, cena["ds1"], ("u", cena["ana_u"], "Gerente"))

        resposta, exportador, _ = self._enviar(client, cena, monkeypatch, "caio@example.com")

        assert resposta.status_code == 400
        exportador.assert_not_called()


def _montar_rls(db_session, make_user, **extra):
    """Uma assinatura de relatorio com RLS, com o modelo sincronizado e tres pessoas no portal (Ana, Beto e Caio)."""
    m = montar(db_session, make_user, **extra)
    m.ana, m.beto, m.caio = make_user("ana@empresa.com"), make_user("beto@empresa.com"), make_user("caio@empresa.com")
    m.dataset = PbiDataset(
        connection_id=m.report.powerbi_connection_id, pbi_workspace_id="pbi-ws", pbi_dataset_id="ds-1", name="M",
        is_effective_identity_required=True,
    )
    db_session.add(m.dataset)
    db_session.commit()
    return m


def _mapa(db_session, m, *linhas):
    db_session.query(DatasetRoleGrant).filter_by(dataset_id=m.dataset.id).delete()
    for pessoa, funcao in linhas:
        db_session.add(DatasetRoleGrant(dataset_id=m.dataset.id, pbi_role=funcao, user_id=pessoa.id))
    db_session.commit()


class TestAssinaturaComRls:
    def test_com_a_chave_desligada_continua_pausando_como_antes(self, db_session, make_user):
        m = _montar_rls(db_session, make_user, recipients=["ana@empresa.com"])
        _mapa(db_session, m, (m.ana, "Gerente"))
        deliver, chamadas = entrega(["ok"])

        rodar(db_session, m.sub, deliver, rls=True)

        assert chamadas == []
        assert recarregar(db_session, m.sub).enabled is False

    def test_um_arquivo_por_destinatario_com_as_funcoes_de_cada_um(self, db_session, make_user):
        m = _montar_rls(db_session, make_user, recipients=["ana@empresa.com", "beto@empresa.com", "estranho@empresa.com"])
        _ligar(db_session)
        _mapa(db_session, m, (m.ana, "Gerente"), (m.beto, "Vendedor"), (m.criador, "Diretor"))
        deliver, chamadas = entrega(["ok"])

        rodar(db_session, m.sub, deliver, rls=True)

        assert [c["recipients"] for c in chamadas] == [["ana@empresa.com"], ["beto@empresa.com"]]
        assert chamadas[0]["identities"] == [{"username": "ana@empresa.com", "roles": ["Gerente"], "datasets": ["ds-1"]}]
        assert chamadas[1]["identities"] == [{"username": "beto@empresa.com", "roles": ["Vendedor"], "datasets": ["ds-1"]}]
        # Nunca a identidade de quem criou a assinatura
        assert all("criador@empresa.com" not in str(c["identities"]) and "Diretor" not in str(c["identities"]) for c in chamadas)
        sub = recarregar(db_session, m.sub)
        assert sub.last_status == "ok" and "2 de 2" in sub.last_message

    def test_a_auditoria_diz_quem_recebeu_e_com_quais_funcoes_sem_os_enderecos(self, db_session, make_user):
        m = _montar_rls(db_session, make_user, recipients=["ana@empresa.com", "estranho@empresa.com"])
        _ligar(db_session)
        _mapa(db_session, m, (m.ana, "Gerente"))
        deliver, _ = entrega(["ok"])

        rodar(db_session, m.sub, deliver, rls=True)

        linha = db_session.query(AuditLog).filter(AuditLog.action == "subscription_sent").one()
        assert f"usuario {m.ana.id}: Gerente" in linha.details and "1 destinatario(s) sem saida" in linha.details
        assert "@" not in linha.details

    def test_destinatario_sem_funcao_nao_recebe_e_os_outros_sim(self, db_session, make_user):
        m = _montar_rls(db_session, make_user, recipients=["ana@empresa.com", "caio@empresa.com"])
        _ligar(db_session)
        _mapa(db_session, m, (m.ana, "Gerente"))
        deliver, chamadas = entrega(["ok"])

        rodar(db_session, m.sub, deliver, rls=True)

        assert [c["recipients"] for c in chamadas] == [["ana@empresa.com"]]

    def test_ninguem_pode_receber_nada_sai_falha_fechada(self, db_session, make_user):
        m = _montar_rls(db_session, make_user, recipients=["caio@empresa.com", "estranho@empresa.com"])
        _ligar(db_session)
        _mapa(db_session, m, (m.ana, "Gerente"))
        deliver, chamadas = entrega(["ok"])

        rodar(db_session, m.sub, deliver, rls=True)

        assert chamadas == []
        assert "Nenhum destinatario" in (recarregar(db_session, m.sub).last_message or "")

    def test_modelo_sem_mapeamento_nao_sai_nem_para_quem_tem_conta(self, db_session, make_user):
        m = _montar_rls(db_session, make_user, recipients=["ana@empresa.com"])
        _ligar(db_session)
        deliver, chamadas = entrega(["ok"])

        rodar(db_session, m.sub, deliver, rls=True)

        assert chamadas == []

    def test_falha_de_um_destinatario_nao_impede_os_outros_e_marca_erro(self, db_session, make_user):
        m = _montar_rls(db_session, make_user, recipients=["ana@empresa.com", "beto@empresa.com"])
        _ligar(db_session)
        _mapa(db_session, m, (m.ana, "Gerente"), (m.beto, "Vendedor"))
        deliver, chamadas = entrega(["erro de envio", "ok"])

        rodar(db_session, m.sub, deliver, trigger="manual", rls=True)

        assert len(chamadas) == 2
        sub = recarregar(db_session, m.sub)
        assert sub.last_status == "error" and "1 de 2" in sub.last_message


class TestCriarAssinaturaComRls:
    def test_a_chave_desligada_recusa_e_ligada_deixa_criar(self, client, cena, db_session):
        client.put(
            "/settings/email/",
            json={"smtp_host": "smtp.x", "smtp_from_email": "relatorios@example.com", "email_allowed_domains": "example.com"},
            headers=cena["admin"],
        )
        url = f"/workspaces/{cena['workspace']['id']}/reports/{cena['rel1']['id']}/subscriptions"
        corpo = {"recipients": ["ana@example.com"], "format": "PDF", "days": [0], "times": ["08:00"]}
        p1, p2, p3 = _pbi_com_rls()

        with p1, p2, p3:
            recusada = client.post(url, json=corpo, headers=cena["admin"])
            _ligar(db_session)
            aceita = client.post(url, json=corpo, headers=cena["admin"])

        assert recusada.status_code == 400 and "Permitir saida" in recusada.json()["detail"]
        assert aceita.status_code == 201, aceita.text


def _item_de_tv(db_session, cena, *, funcao="Gerente", montador=None):
    tv = Tv(name="TV", link_secret=uuid.uuid4().hex, code_secret=uuid.uuid4().hex)
    db_session.add(tv)
    db_session.commit()
    item = TvItem(
        tv_id=tv.id, position=0, kind="report_page", seconds=15, report_id=cena["rel1"]["id"], page_name="P1",
        rls_role=funcao, rls_role_user_id=(montador or cena["ana_u"]).id,
    )
    db_session.add(item)
    db_session.commit()
    return tv, item


class TestModoTv:
    def _embed_tv(self, db_session, cena, tv, item):
        from app.routers import tvs

        report = db_session.get(Report, item.report_id)
        gerador = MagicMock(return_value=_token("tok-tv"))
        p1, p2, _ = _pbi_com_rls()
        with p1, p2, patch.object(powerbi_core, "generate_embed_token", gerador):
            return tvs._rls_item_embed(db_session, tv, item, report), gerador

    def test_o_token_leva_a_funcao_escolhida_e_um_nome_neutro_nunca_o_email_de_alguem(self, db_session, cena):
        _ligar(db_session)
        _mapear(db_session, cena["ds1"], ("u", cena["ana_u"], "Gerente"))
        tv, item = _item_de_tv(db_session, cena)

        config, gerador = self._embed_tv(db_session, cena, tv, item)

        assert config.access_token == "tok-tv"
        kwargs = gerador.call_args.kwargs
        assert kwargs["roles"] == ["Gerente"] and kwargs["username"] == "bihoster-funcoes"
        assert db_session.query(AuditLog).filter(AuditLog.action == "rls_output_tv").count() == 1

    def test_funcoes_diferentes_nao_dividem_o_token(self, db_session, cena):
        _ligar(db_session)
        _mapear(db_session, cena["ds1"], ("u", cena["ana_u"], "Gerente"), ("u", cena["ana_u"], "Vendedor"))
        tv, item = _item_de_tv(db_session, cena, funcao="Gerente")
        _, item2 = _item_de_tv(db_session, cena, funcao="Vendedor")

        self._embed_tv(db_session, cena, tv, item)
        _, gerador = self._embed_tv(db_session, cena, tv, item2)

        assert gerador.call_args.kwargs["roles"] == ["Vendedor"]

    def test_quem_escolheu_a_funcao_e_perdeu_deixa_o_item_fora_da_tv(self, db_session, cena):
        _ligar(db_session)
        _mapear(db_session, cena["ds1"], ("u", cena["beto_u"], "Vendedor"))  # a Ana nao tem mais a funcao
        tv, item = _item_de_tv(db_session, cena, funcao="Gerente")

        with pytest.raises(HTTPException) as erro:
            self._embed_tv(db_session, cena, tv, item)

        assert erro.value.status_code == 403

    def test_chave_desligada_o_item_nao_passa(self, db_session, cena):
        _mapear(db_session, cena["ds1"], ("u", cena["ana_u"], "Gerente"))
        tv, item = _item_de_tv(db_session, cena)

        with pytest.raises(HTTPException) as erro:
            self._embed_tv(db_session, cena, tv, item)

        assert erro.value.status_code == 403

    def _montar_lista(self, client, cena, funcao):
        tv = client.post("/tvs/", json={"name": "Sala"}, headers=cena["admin"]).json()
        p1, p2, _ = _pbi_com_rls()
        item = {"kind": "report_page", "seconds": 15, "report_id": cena["rel1"]["id"], "page_name": "P1"}
        if funcao:
            item["rls_role"] = funcao
        with p1, p2:
            return client.put(f"/tvs/{tv['id']}/items", json={"items": [item]}, headers=cena["admin"])

    def test_montar_a_lista_exige_a_chave_ligada_a_funcao_e_que_quem_monta_a_tenha(self, client, cena, db_session):
        assert self._montar_lista(client, cena, "Gerente").status_code == 400  # chave desligada
        _ligar(db_session)
        _mapear(db_session, cena["ds1"], ("u", cena["admin_u"], "Gerente"), ("u", cena["ana_u"], "Vendedor"))

        assert self._montar_lista(client, cena, None).status_code == 400  # sem escolher funcao
        assert self._montar_lista(client, cena, "Vendedor").status_code == 403  # funcao que o montador nao tem
        pronta = self._montar_lista(client, cena, "Gerente")

        assert pronta.status_code == 200, pronta.text
        assert pronta.json()["items"][0]["rls_role"] == "Gerente"
        guardado = db_session.query(TvItem).one()
        assert guardado.rls_role_user_id == cena["admin_u"].id

    def test_a_tela_sabe_as_funcoes_que_a_pessoa_tem(self, client, cena, db_session):
        _ligar(db_session)
        _mapear(db_session, cena["ds1"], ("u", cena["admin_u"], "Gerente"))
        p1, p2, _ = _pbi_com_rls()

        with p1, p2:
            resposta = client.get(f"/tvs/report-rls/{cena['rel1']['id']}", headers=cena["admin"])

        assert resposta.json() == {"rls": True, "switch_on": True, "roles": ["Gerente"]}


class TestNucleo:
    def test_o_chat_de_ia_continua_bloqueando_relatorio_com_rls(self):
        from app.core import chat_dataset

        assert "RLS" in chat_dataset.REASON_RLS

    def test_sem_funcoes_nao_ha_identidade(self, db_session, cena):
        _ligar(db_session)

        with pytest.raises(rls_output.RlsOutputBlocked):
            rls_output.identity_for_user(db_session, cena["ana_u"], db_session.get(Report, cena["rel1"]["id"]))

    def test_funcoes_de_grupo_valem_para_quem_esta_nele(self, db_session, cena):
        from app.models.workspace import GroupMember

        _ligar(db_session)
        db_session.add(GroupMember(group_id=cena["regional"].id, user_id=cena["ana_u"].id))
        db_session.add(DatasetRoleGrant(dataset_id=cena["ds1"].id, pbi_role="Regional", group_id=cena["regional"].id))
        db_session.commit()

        identidade = rls_output.identity_for_user(db_session, cena["ana_u"], db_session.get(Report, cena["rel1"]["id"]))

        assert identidade.roles == ("Regional",) and identidade.username == "ana@example.com"

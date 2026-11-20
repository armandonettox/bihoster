"""Pedido de mais tempo de acesso: quem esta fora do horario pede, quem tem a permissao de liberar aprova (por um tempo
limitado) ou recusa, e a liberacao acaba sozinha."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from app.core.email_sender import EmailError
from app.models.access_extension import AccessExtensionRequest
from app.models.audit_log import AuditLog
from app.models.settings import AppSettings
from tests.test_access_schedule import (  # noqa: F401  (admin, pessoa e relogio sao fixtures)
    PASSWORD,
    SABADO_10H,
    SEGUNDA_10H,
    SEGUNDA_20H,
    _entrar,
    _grupo,
    _id,
    admin,
    pessoa,
    pessoa_id,
    relogio,
)

SEND = "app.core.account_emails.send_email"
SMTP = {
    "smtp_host": "smtp.exemplo.test",
    "smtp_port": 587,
    "smtp_security": "starttls",
    "smtp_username": "usuario",
    "smtp_password": "segredo-smtp",
    "smtp_from_email": "relatorios@exemplo.com",
    "smtp_from_name": "BIHoster",
}
MOTIVO = {"reason": "Preciso fechar o relatorio do mes"}


@pytest.fixture
def aprovador(client, admin):
    """Uma pessoa comum (fora do grupo com horario) que pode liberar acesso."""
    headers = _entrar(client, "aprovador@example.com")
    uid = _id(client, admin, "aprovador@example.com")
    client.put(
        f"/access/users/{uid}",
        json={"blocks": [{"workspace_id": None, "permissions": ["membros.ver", "membros.liberar-horario"]}]},
        headers=admin,
    )
    return headers


@pytest.fixture
def limitada(client, admin, pessoa, relogio):
    """A `pessoa` no grupo "Seg a Sex, 08:00 as 18:00", num sabado: fora do horario."""
    _grupo(client, admin)
    relogio(SABADO_10H)
    return pessoa


def _pedir(client, headers, corpo=None):
    return client.post("/access-extensions/mine", json=corpo or MOTIVO, headers=headers)


def _aprovar(client, headers, pedido_id, corpo=None):
    return client.post(f"/access-extensions/{pedido_id}/approve", json={"minutes": 120} if corpo is None else corpo, headers=headers)


def _acessa(client, headers):
    return client.get("/auth/me", headers=headers).status_code


class TestPedir:
    def test_fora_do_horario_cria_o_pedido_e_a_pessoa_continua_sem_acesso(self, client, limitada):
        resposta = _pedir(client, limitada)

        assert resposta.status_code == 201
        assert resposta.json()["status"] == "pending"
        assert resposta.json()["reason"] == MOTIVO["reason"]
        assert _acessa(client, limitada) == 403

    def test_o_pedido_mais_recente_pode_ser_consultado_fora_do_horario(self, client, limitada):
        assert client.get("/access-extensions/mine", headers=limitada).json() == {"request": None}
        criado = _pedir(client, limitada).json()

        mine = client.get("/access-extensions/mine", headers=limitada).json()["request"]
        assert mine["id"] == criado["id"] and mine["status"] == "pending"

    def test_dentro_do_horario_nao_precisa_pedir(self, client, admin, pessoa, relogio):
        _grupo(client, admin)
        relogio(SEGUNDA_10H)

        assert _pedir(client, pessoa).status_code == 400

    def test_pedido_aberto_nao_cria_outro(self, client, limitada, db_session):
        primeiro = _pedir(client, limitada).json()
        segundo = _pedir(client, limitada, {"reason": "Outro motivo qualquer"})

        assert segundo.json()["id"] == primeiro["id"]
        assert db_session.query(AccessExtensionRequest).count() == 1

    @pytest.mark.parametrize("motivo", ["", "  a  ", "abc", "x" * 501])
    def test_motivo_curto_ou_longo_demais_da_422(self, client, limitada, motivo):
        assert _pedir(client, limitada, {"reason": motivo}).status_code == 422

    def test_sem_sessao_nao_pede(self, client):
        assert client.post("/access-extensions/mine", json=MOTIVO).status_code == 401
        assert client.get("/access-extensions/mine").status_code == 401

    def test_registra_na_auditoria(self, client, limitada, db_session):
        _pedir(client, limitada)

        assert db_session.query(AuditLog).filter(AuditLog.action == "request_extension").count() == 1


class TestAprovar:
    def test_aprovar_por_duas_horas_libera_e_depois_volta_ao_horario(self, client, limitada, aprovador, relogio):
        pedido = _pedir(client, limitada).json()
        resposta = _aprovar(client, aprovador, pedido["id"], {"minutes": 120})

        assert resposta.status_code == 200
        assert resposta.json()["status"] == "approved" and resposta.json()["active"] is True
        assert _acessa(client, limitada) == 200
        relogio(SABADO_10H + timedelta(minutes=119))
        assert _acessa(client, limitada) == 200
        relogio(SABADO_10H + timedelta(minutes=121))
        assert _acessa(client, limitada) == 403  # acabou sozinha

    def test_aprovar_ate_um_horario_vale_no_fuso_do_sistema(self, client, admin, pessoa, aprovador, relogio):
        _grupo(client, admin)
        relogio(SEGUNDA_20H)  # 20:00 em Sao Paulo, fora das faixas
        pedido = _pedir(client, pessoa).json()
        _aprovar(client, aprovador, pedido["id"], {"until_time": "22:00"})

        relogio(SEGUNDA_20H + timedelta(minutes=119))  # 21:59 local
        assert _acessa(client, pessoa) == 200
        relogio(SEGUNDA_20H + timedelta(minutes=121))  # 22:01 local
        assert _acessa(client, pessoa) == 403

    def test_horario_que_ja_passou_hoje_vale_ate_o_de_amanha(self, client, admin, pessoa, aprovador, relogio):
        _grupo(client, admin)
        relogio(SEGUNDA_20H)  # 20:00 local
        pedido = _pedir(client, pessoa).json()
        resposta = _aprovar(client, aprovador, pedido["id"], {"until_time": "08:00"})

        assert resposta.status_code == 200
        relogio(SEGUNDA_20H + timedelta(hours=11))  # 07:00 de terca, ainda dentro da liberacao
        assert _acessa(client, pessoa) == 200

    @pytest.mark.parametrize(
        "corpo,esperado",
        [
            ({}, 400),
            ({"minutes": 60, "until_time": "22:00"}, 400),
            ({"minutes": 5}, 422),
            ({"minutes": 1441}, 422),
            ({"until_time": "25:00"}, 400),
            ({"until_time": "abc"}, 400),
        ],
    )
    def test_prazo_invalido(self, client, limitada, aprovador, corpo, esperado):
        pedido = _pedir(client, limitada).json()

        assert _aprovar(client, aprovador, pedido["id"], corpo).status_code == esperado
        assert _acessa(client, limitada) == 403

    def test_administrador_tambem_aprova(self, client, limitada, admin):
        pedido = _pedir(client, limitada).json()

        assert _aprovar(client, admin, pedido["id"]).status_code == 200

    def test_pedido_ja_respondido_nao_responde_de_novo(self, client, limitada, aprovador):
        pedido = _pedir(client, limitada).json()
        _aprovar(client, aprovador, pedido["id"])

        assert _aprovar(client, aprovador, pedido["id"]).status_code == 409
        assert client.post(f"/access-extensions/{pedido['id']}/deny", json={}, headers=aprovador).status_code == 409

    def test_ninguem_libera_o_proprio_acesso(self, client, admin, pessoa, pessoa_id, relogio):
        _grupo(client, admin)
        client.put(
            f"/access/users/{pessoa_id}",
            json={"blocks": [{"workspace_id": None, "permissions": ["membros.ver", "membros.liberar-horario"]}]},
            headers=admin,
        )
        relogio(SABADO_10H)
        pedido = _pedir(client, pessoa).json()
        relogio(SEGUNDA_10H)  # voltou ao horario com o pedido ainda aberto

        assert _aprovar(client, pessoa, pedido["id"]).status_code == 400

    def test_quem_nao_tem_a_permissao_nao_aprova(self, client, admin, limitada, relogio):
        outra = _entrar(client, "outra@example.com")
        pedido = _pedir(client, limitada).json()

        assert _aprovar(client, outra, pedido["id"]).status_code == 403

    def test_registra_quem_aprovou_ate_quando_e_na_auditoria(self, client, limitada, aprovador, db_session):
        pedido = _pedir(client, limitada).json()
        resposta = _aprovar(client, aprovador, pedido["id"]).json()

        assert resposta["decided_by_name"] == "Aprovador"
        registro = db_session.query(AuditLog).filter(AuditLog.action == "approve_extension").one()
        assert "pessoa@example.com" in registro.details

    def test_liberacao_nao_vale_para_conta_bloqueada(self, client, admin, limitada, aprovador, pessoa_id):
        pedido = _pedir(client, limitada).json()
        _aprovar(client, aprovador, pedido["id"])
        client.post(f"/users/{pessoa_id}/block", headers=admin)

        assert _acessa(client, limitada) == 401


class TestRecusarEEncerrar:
    def test_recusar_guarda_o_motivo_e_a_pessoa_continua_fora(self, client, limitada, aprovador):
        pedido = _pedir(client, limitada).json()
        resposta = client.post(f"/access-extensions/{pedido['id']}/deny", json={"note": "Fecha amanha"}, headers=aprovador)

        assert resposta.status_code == 200 and resposta.json()["status"] == "denied"
        mine = client.get("/access-extensions/mine", headers=limitada).json()["request"]
        assert mine["status"] == "denied" and mine["note"] == "Fecha amanha"
        assert _acessa(client, limitada) == 403

    def test_depois_de_recusado_a_pessoa_pode_pedir_de_novo(self, client, limitada, aprovador):
        primeiro = _pedir(client, limitada).json()
        client.post(f"/access-extensions/{primeiro['id']}/deny", json={}, headers=aprovador)

        segundo = _pedir(client, limitada)

        assert segundo.status_code == 201 and segundo.json()["id"] != primeiro["id"]

    def test_encerrar_a_liberacao_antes_do_prazo(self, client, limitada, aprovador):
        pedido = _pedir(client, limitada).json()
        _aprovar(client, aprovador, pedido["id"], {"minutes": 600})
        assert _acessa(client, limitada) == 200

        resposta = client.post(f"/access-extensions/{pedido['id']}/revoke", headers=aprovador)

        assert resposta.status_code == 200 and resposta.json()["status"] == "revoked" and resposta.json()["active"] is False
        assert _acessa(client, limitada) == 403
        assert client.post(f"/access-extensions/{pedido['id']}/revoke", headers=aprovador).status_code == 409

    def test_nao_encerra_o_que_nao_foi_aprovado(self, client, limitada, aprovador):
        pedido = _pedir(client, limitada).json()

        assert client.post(f"/access-extensions/{pedido['id']}/revoke", headers=aprovador).status_code == 409

    def test_pedido_inexistente_da_404(self, client, aprovador):
        assert _aprovar(client, aprovador, 9999).status_code == 404
        assert client.post("/access-extensions/9999/deny", json={}, headers=aprovador).status_code == 404


class TestLista:
    def test_lista_os_abertos_e_os_decididos_recentes_com_quem_pediu(self, client, limitada, aprovador, admin):
        primeiro = _pedir(client, limitada).json()
        _aprovar(client, aprovador, primeiro["id"])
        lista = client.get("/access-extensions/", headers=aprovador).json()

        assert [i["id"] for i in lista] == [primeiro["id"]]
        assert lista[0]["user_email"] == "pessoa@example.com" and lista[0]["active"] is True

    def test_quem_nao_pode_liberar_nao_ve_a_lista(self, client, limitada):
        assert client.get("/access-extensions/", headers=limitada).status_code == 403

    def test_pedido_antigo_ja_decidido_sai_da_lista(self, client, limitada, aprovador, db_session):
        pedido = _pedir(client, limitada).json()
        client.post(f"/access-extensions/{pedido['id']}/deny", json={}, headers=aprovador)
        db_session.query(AccessExtensionRequest).update({"created_at": datetime.now(timezone.utc) - timedelta(days=30)})
        db_session.commit()

        assert client.get("/access-extensions/", headers=aprovador).json() == []

    def test_apagar_a_pessoa_leva_os_pedidos(self, client, admin, limitada, pessoa_id, db_session):
        _pedir(client, limitada)
        assert db_session.query(AccessExtensionRequest).count() == 1

        assert client.delete(f"/users/{pessoa_id}", headers=admin).status_code in (200, 204)
        assert db_session.query(AccessExtensionRequest).count() == 0


class TestAvisoPorEmail:
    @pytest.fixture
    def email_pronto(self, client, admin, db_session):
        assert client.put("/settings/email/", json=SMTP, headers=admin).status_code == 200
        row = db_session.query(AppSettings).filter(AppSettings.id == 1).first()
        row.site_url = "bi.exemplo.test"
        db_session.commit()

    def test_avisa_quem_pode_liberar_com_o_motivo_e_o_link(self, client, limitada, aprovador, email_pronto):
        with patch(SEND) as enviar:
            assert _pedir(client, limitada).status_code == 201

        destinos = {chamada.args[1][0] for chamada in enviar.call_args_list}
        assert destinos == {"admin@example.com", "aprovador@example.com"}
        corpo = enviar.call_args_list[0].args[3]
        assert MOTIVO["reason"] in corpo and "https://bi.exemplo.test/users" in corpo

    def test_falha_no_envio_nao_derruba_o_pedido(self, client, limitada, email_pronto):
        with patch(SEND, side_effect=EmailError("servidor fora")):
            assert _pedir(client, limitada).status_code == 201

    def test_sem_servidor_de_email_o_pedido_funciona_do_mesmo_jeito(self, client, limitada):
        with patch(SEND) as enviar:
            assert _pedir(client, limitada).status_code == 201

        enviar.assert_not_called()

    def test_nao_avisa_conta_bloqueada(self, client, admin, limitada, aprovador, email_pronto):
        client.post(f"/users/{_id(client, admin, 'aprovador@example.com')}/block", headers=admin)
        with patch(SEND) as enviar:
            _pedir(client, limitada)

        assert {chamada.args[1][0] for chamada in enviar.call_args_list} == {"admin@example.com"}


class TestRespostaPorEmail:
    @pytest.fixture
    def email_pronto(self, client, admin, db_session):
        assert client.put("/settings/email/", json=SMTP, headers=admin).status_code == 200
        row = db_session.query(AppSettings).filter(AppSettings.id == 1).first()
        row.site_url = "bi.exemplo.test"
        db_session.commit()

    def _destinos(self, enviar):
        return [chamada.args[1][0] for chamada in enviar.call_args_list]

    def test_aprovado_conta_a_quem_pediu_ate_quando_vale_e_o_link_de_entrada(self, client, limitada, aprovador, email_pronto):
        pedido = _pedir(client, limitada).json()
        with patch(SEND) as enviar:
            assert _aprovar(client, aprovador, pedido["id"], {"minutes": 120}).status_code == 200

        assert self._destinos(enviar) == ["pessoa@example.com"]
        assunto, corpo = enviar.call_args.args[2], enviar.call_args.args[3]
        assert "aprovado" in assunto
        assert "12:00" in corpo and "America/Sao_Paulo" in corpo  # sabado 10:00 local + 2 horas
        assert "https://bi.exemplo.test/login" in corpo

    def test_recusado_conta_a_quem_pediu_com_o_motivo(self, client, limitada, aprovador, email_pronto):
        pedido = _pedir(client, limitada).json()
        with patch(SEND) as enviar:
            client.post(f"/access-extensions/{pedido['id']}/deny", json={"note": "Fecha amanha"}, headers=aprovador)

        assert self._destinos(enviar) == ["pessoa@example.com"]
        assert "recusado" in enviar.call_args.args[2] and "Motivo: Fecha amanha" in enviar.call_args.args[3]

    def test_recusado_sem_motivo_nao_inventa_motivo(self, client, limitada, aprovador, email_pronto):
        pedido = _pedir(client, limitada).json()
        with patch(SEND) as enviar:
            client.post(f"/access-extensions/{pedido['id']}/deny", json={}, headers=aprovador)

        assert "Motivo" not in enviar.call_args.args[3]

    def test_falha_no_envio_nao_desfaz_a_decisao(self, client, limitada, aprovador, email_pronto):
        pedido = _pedir(client, limitada).json()
        with patch(SEND, side_effect=EmailError("servidor fora")):
            resposta = _aprovar(client, aprovador, pedido["id"])

        assert resposta.status_code == 200 and resposta.json()["status"] == "approved"
        assert _acessa(client, limitada) == 200

    def test_sem_servidor_de_email_decide_do_mesmo_jeito(self, client, limitada, aprovador):
        pedido = _pedir(client, limitada).json()
        with patch(SEND) as enviar:
            assert _aprovar(client, aprovador, pedido["id"]).status_code == 200

        enviar.assert_not_called()

    def test_conta_bloqueada_nao_recebe(self, client, admin, limitada, aprovador, pessoa_id, email_pronto):
        pedido = _pedir(client, limitada).json()
        client.post(f"/users/{pessoa_id}/block", headers=admin)
        with patch(SEND) as enviar:
            client.post(f"/access-extensions/{pedido['id']}/deny", json={}, headers=aprovador)

        enviar.assert_not_called()

"""Rotas de configuracao de e-mail: so administradores, a senha nunca sai pela API e nunca e
gravada em texto claro, e o teste de envio respeita os dominios permitidos."""

from unittest.mock import patch

import pytest
from sqlalchemy import text

from app.core import email_sender
from app.core.email_sender import EmailError
from app.models.audit_log import AuditLog
from app.models.settings import AppSettings

PASSWORD = "SenhaForte123"
BASE = {
    "smtp_host": "smtp.exemplo.test",
    "smtp_port": 587,
    "smtp_security": "starttls",
    "smtp_username": "usuario",
    "smtp_password": "segredo-smtp",
    "smtp_from_email": "relatorios@exemplo.com",
    "smtp_from_name": "BIHoster",
}


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


def _salvar(client, admin, **extra):
    return client.put("/settings/email/", json={**BASE, **extra}, headers=admin)


class TestPermissao:
    def test_ler_e_gravar_exigem_estar_logado(self, client):
        assert client.get("/settings/email/").status_code == 401
        assert client.put("/settings/email/", json=BASE).status_code == 401
        assert client.post("/settings/email/test", json={"to": "a@x.com"}).status_code == 401

    def test_quem_nao_e_administrador_nao_le_nem_grava_nem_testa(self, client, pessoa):
        assert client.get("/settings/email/", headers=pessoa).status_code == 403
        assert client.put("/settings/email/", json=BASE, headers=pessoa).status_code == 403
        assert client.post("/settings/email/test", json={"to": "a@x.com"}, headers=pessoa).status_code == 403

    def test_o_status_serve_para_qualquer_pessoa_logada_e_so_diz_sim_ou_nao(self, client, admin, pessoa):
        assert client.get("/settings/email/status", headers=pessoa).json() == {"configured": False}

        _salvar(client, admin)

        resp = client.get("/settings/email/status", headers=pessoa)
        assert resp.json() == {"configured": True}
        assert "smtp.exemplo.test" not in resp.text

    def test_o_status_exige_login(self, client):
        assert client.get("/settings/email/status").status_code == 401


class TestSenha:
    def test_a_senha_nunca_volta_pela_api_so_um_aviso_de_que_existe(self, client, admin):
        resp = _salvar(client, admin)

        assert resp.status_code == 200
        corpo = resp.json()
        assert corpo["smtp_password_configured"] is True
        assert "segredo-smtp" not in resp.text
        assert "smtp_password" not in corpo
        assert "segredo-smtp" not in client.get("/settings/email/", headers=admin).text

    def test_a_senha_fica_cifrada_no_banco(self, client, admin, db_session):
        _salvar(client, admin)

        bruto = db_session.execute(text("SELECT smtp_password FROM app_settings WHERE id = 1")).scalar()
        assert bruto and "segredo-smtp" not in bruto
        assert db_session.query(AppSettings).first().smtp_password == "segredo-smtp"

    def test_a_senha_nao_vaza_pela_rota_publica_de_configuracoes(self, client, admin):
        _salvar(client, admin)

        publica = client.get("/settings/")

        assert publica.status_code == 200
        for segredo in ("segredo-smtp", "smtp.exemplo.test", "usuario", "relatorios@exemplo.com"):
            assert segredo not in publica.text

    def test_salvar_sem_mandar_a_senha_mantem_a_que_ja_existe(self, client, admin, db_session):
        _salvar(client, admin)

        resp = client.put("/settings/email/", json={"smtp_from_name": "Outro Nome"}, headers=admin)

        assert resp.json()["smtp_password_configured"] is True
        assert db_session.query(AppSettings).first().smtp_password == "segredo-smtp"

    def test_trocar_a_senha(self, client, admin, db_session):
        _salvar(client, admin)

        client.put("/settings/email/", json={"smtp_password": "senha-nova"}, headers=admin)

        db_session.expire_all()
        assert db_session.query(AppSettings).first().smtp_password == "senha-nova"

    def test_texto_vazio_apaga_a_senha(self, client, admin):
        _salvar(client, admin)

        resp = client.put("/settings/email/", json={"smtp_password": ""}, headers=admin)

        assert resp.json()["smtp_password_configured"] is False


class TestValidacao:
    def test_porta_fora_do_intervalo(self, client, admin):
        assert _salvar(client, admin, smtp_port=0).status_code == 422
        assert _salvar(client, admin, smtp_port=70000).status_code == 422

    def test_tipo_de_seguranca_desconhecido(self, client, admin):
        assert _salvar(client, admin, smtp_security="tls13").status_code == 422

    def test_remetente_precisa_ser_um_e_mail(self, client, admin):
        assert _salvar(client, admin, smtp_from_email="isso-nao-e-email").status_code == 422

    def test_usuario_e_senha_sem_criptografia_sao_recusados(self, client, admin):
        resp = _salvar(client, admin, smtp_security="none")

        assert resp.status_code == 422

    def test_trocar_so_a_seguranca_para_nenhuma_com_senha_ja_salva_tambem_e_recusado(self, client, admin):
        _salvar(client, admin)

        resp = client.put("/settings/email/", json={"smtp_security": "none"}, headers=admin)

        assert resp.status_code == 400
        assert "texto claro" in resp.json()["detail"]
        assert client.get("/settings/email/", headers=admin).json()["smtp_security"] == "starttls"

    def test_sem_criptografia_e_permitido_quando_nao_ha_usuario_nem_senha(self, client, admin):
        resp = client.put(
            "/settings/email/",
            json={"smtp_host": "relay.interno", "smtp_security": "none", "smtp_from_email": "a@interno.com"},
            headers=admin,
        )

        assert resp.status_code == 200

    def test_dominios_sao_normalizados(self, client, admin):
        resp = _salvar(client, admin, email_allowed_domains=" @Empresa.com, empresa.com ,PARCEIRO.com.br ")

        assert resp.json()["email_allowed_domains"] == "empresa.com,parceiro.com.br"

    def test_esta_configurado_so_com_servidor_e_remetente(self, client, admin):
        parcial = client.put("/settings/email/", json={"smtp_host": "smtp.x"}, headers=admin).json()
        assert parcial["configured"] is False

        completo = client.put("/settings/email/", json={"smtp_from_email": "a@x.com"}, headers=admin).json()
        assert completo["configured"] is True


class TestAuditoria:
    def test_alterar_registra_so_os_nomes_dos_campos(self, client, admin, db_session):
        _salvar(client, admin)

        log = db_session.query(AuditLog).filter(AuditLog.action == "update_email_settings").one()
        assert "smtp_host" in log.details and "smtp_password" in log.details
        for valor in ("segredo-smtp", "smtp.exemplo.test", "usuario"):
            assert valor not in log.details


class TestEmailDeTeste:
    def test_sem_configurar_pede_para_configurar(self, client, admin):
        resp = client.post("/settings/email/test", json={"to": "a@x.com"}, headers=admin)

        assert resp.status_code == 400
        assert "Configure" in resp.json()["detail"]

    def test_envia_para_o_endereco_pedido(self, client, admin, db_session):
        _salvar(client, admin)

        with patch("app.routers.email_settings.send_email") as enviar:
            resp = client.post("/settings/email/test", json={"to": "alvo@exemplo.com"}, headers=admin)

        assert resp.status_code == 200
        config, destinatarios = enviar.call_args.args[0], enviar.call_args.args[1]
        assert destinatarios == ["alvo@exemplo.com"]
        assert (config.host, config.username, config.password) == ("smtp.exemplo.test", "usuario", "segredo-smtp")
        assert db_session.query(AuditLog).filter(AuditLog.action == "send_test_email").count() == 1

    def test_falha_do_servidor_vira_502_com_mensagem_clara_sem_a_senha(self, client, admin):
        _salvar(client, admin)

        with patch("app.routers.email_settings.send_email", side_effect=EmailError("O servidor recusou o usuario ou a senha do SMTP.")):
            resp = client.post("/settings/email/test", json={"to": "a@x.com"}, headers=admin)

        assert resp.status_code == 502
        assert "usuario ou a senha" in resp.json()["detail"]
        assert "segredo-smtp" not in resp.text

    def test_destinatario_fora_dos_dominios_permitidos_e_barrado_sem_enviar(self, client, admin):
        _salvar(client, admin, email_allowed_domains="empresa.com")

        with patch("app.routers.email_settings.send_email") as enviar:
            resp = client.post("/settings/email/test", json={"to": "x@gmail.com"}, headers=admin)

        assert resp.status_code == 400
        enviar.assert_not_called()

    def test_endereco_invalido_e_recusado(self, client, admin):
        _salvar(client, admin)

        assert client.post("/settings/email/test", json={"to": "nao-e-email"}, headers=admin).status_code == 422

    def test_limite_de_envios_por_minuto(self, client, admin):
        _salvar(client, admin)

        with patch("app.routers.email_settings.send_email"):
            codigos = [
                client.post("/settings/email/test", json={"to": "a@x.com"}, headers=admin).status_code for _ in range(6)
            ]

        assert codigos == [200, 200, 200, 200, 200, 429]

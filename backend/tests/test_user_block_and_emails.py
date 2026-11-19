"""Bloquear e desbloquear pessoas, e os e-mails de conta (aviso de que foi adicionada e link de nova senha)."""

from unittest.mock import patch

import pytest

from app.core.email_sender import EmailError
from app.models.audit_log import AuditLog
from app.models.settings import AppSettings

PASSWORD = "SenhaForte123"
SMTP = {
    "smtp_host": "smtp.exemplo.test",
    "smtp_port": 587,
    "smtp_security": "starttls",
    "smtp_username": "usuario",
    "smtp_password": "segredo-smtp",
    "smtp_from_email": "relatorios@exemplo.com",
    "smtp_from_name": "BIHoster",
}
SEND = "app.core.account_emails.send_email"


def _entrar(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    resposta = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    return {"Authorization": f"Bearer {resposta.json()['access_token']}"}


@pytest.fixture
def admin(client):
    return _entrar(client, "admin@example.com")


@pytest.fixture
def alvo(client, admin):
    _entrar(client, "alvo@example.com")
    return next(u["id"] for u in client.get("/users/", headers=admin).json() if u["email"] == "alvo@example.com")


@pytest.fixture
def email_pronto(client, admin, db_session):
    """Servidor de e-mail configurado e endereco do site preenchido."""
    assert client.put("/settings/email/", json=SMTP, headers=admin).status_code == 200
    row = db_session.query(AppSettings).filter(AppSettings.id == 1).first()
    row.site_url = "bi.exemplo.test"
    db_session.commit()


def _login(client, email="alvo@example.com"):
    return client.post("/auth/login", json={"email": email, "password": PASSWORD})


class TestBloqueio:
    def test_bloqueada_nao_entra_mas_a_lista_mostra(self, client, admin, alvo):
        assert client.post(f"/users/{alvo}/block", headers=admin).status_code == 204
        resposta = _login(client)
        assert resposta.status_code == 403
        assert "bloqueada" in resposta.json()["detail"]
        pessoa = next(u for u in client.get("/users/", headers=admin).json() if u["id"] == alvo)
        assert pessoa["is_blocked"] is True

    def test_sessao_aberta_cai_na_hora(self, client, admin, alvo):
        sessao = _entrar(client, "alvo@example.com")
        assert client.get("/auth/me", headers=sessao).status_code == 200
        client.post(f"/users/{alvo}/block", headers=admin)
        assert client.get("/auth/me", headers=sessao).status_code == 401

    def test_desbloquear_devolve_o_acesso(self, client, admin, alvo):
        client.post(f"/users/{alvo}/block", headers=admin)
        assert client.post(f"/users/{alvo}/unblock", headers=admin).status_code == 204
        assert _login(client).status_code == 200

    def test_nao_bloqueia_a_si_mesmo_nem_o_ultimo_administrador(self, client, admin):
        meu_id = client.get("/auth/me", headers=admin).json()["id"]
        assert client.post(f"/users/{meu_id}/block", headers=admin).status_code == 400

    def test_quem_so_pode_bloquear_nao_bloqueia_administrador(self, client, admin, alvo):
        outra = _entrar(client, "outra@example.com")
        outra_id = client.get("/auth/me", headers=outra).json()["id"]
        client.put(
            f"/access/users/{outra_id}",
            json={"blocks": [{"workspace_id": None, "permissions": ["membros.bloquear"]}]},
            headers=admin,
        )
        admin_id = client.get("/auth/me", headers=admin).json()["id"]
        assert client.post(f"/users/{admin_id}/block", headers=outra).status_code == 403
        assert client.post(f"/users/{alvo}/block", headers=outra).status_code == 204

    def test_bloquear_registra_na_auditoria(self, client, admin, alvo, db_session):
        client.post(f"/users/{alvo}/block", headers=admin)
        client.post(f"/users/{alvo}/unblock", headers=admin)
        acoes = {a.action for a in db_session.query(AuditLog).all()}
        assert {"block_user", "unblock_user"} <= acoes

    def test_pessoa_inexistente_da_404(self, client, admin):
        assert client.post("/users/9999/block", headers=admin).status_code == 404


class TestEmailDeNovaSenha:
    def test_envia_so_para_o_email_da_pessoa_e_nao_devolve_o_link(self, client, admin, alvo, email_pronto):
        with patch(SEND) as enviar:
            resposta = client.post(f"/users/{alvo}/send-reset-email", headers=admin)
        assert resposta.status_code == 200
        assert "token" not in resposta.text
        _, destinos, assunto, corpo = enviar.call_args.args
        assert destinos == ["alvo@example.com"]
        assert "https://bi.exemplo.test/reset-password?token=" in corpo

    def test_sem_servidor_de_email_explica_o_que_fazer(self, client, admin, alvo):
        resposta = client.post(f"/users/{alvo}/send-reset-email", headers=admin)
        assert resposta.status_code == 400
        assert "e-mail" in resposta.json()["detail"]

    def test_falha_do_servidor_vira_400_com_mensagem(self, client, admin, alvo, email_pronto):
        with patch(SEND, side_effect=EmailError("Servidor recusou")):
            resposta = client.post(f"/users/{alvo}/send-reset-email", headers=admin)
        assert resposta.status_code == 400
        assert resposta.json()["detail"] == "Servidor recusou"

    def test_pessoa_bloqueada_nao_recebe(self, client, admin, alvo, email_pronto):
        client.post(f"/users/{alvo}/block", headers=admin)
        with patch(SEND) as enviar:
            resposta = client.post(f"/users/{alvo}/send-reset-email", headers=admin)
        assert resposta.status_code == 400
        enviar.assert_not_called()


class TestEmailDeBoasVindas:
    def test_quem_tem_conta_recebe_o_link_de_entrada(self, client, admin, alvo, email_pronto):
        with patch(SEND) as enviar:
            resposta = client.post("/users/welcome-email", json={"email": "alvo@example.com"}, headers=admin)
        assert resposta.status_code == 200
        assert resposta.json()["kind"] == "added"
        assert "https://bi.exemplo.test/login" in enviar.call_args.args[3]

    def test_convite_pendente_recebe_o_link_do_cadastro(self, client, admin, email_pronto):
        grupo = client.post("/groups/", json={"name": "Dados"}, headers=admin).json()["id"]
        client.post(f"/groups/{grupo}/invite", json={"email": "novo@example.com"}, headers=admin)
        with patch(SEND) as enviar:
            resposta = client.post("/users/welcome-email", json={"email": "novo@example.com"}, headers=admin)
        assert resposta.status_code == 200
        assert resposta.json()["kind"] == "invited"
        assert "https://bi.exemplo.test/register" in enviar.call_args.args[3]

    def test_email_desconhecido_da_404(self, client, admin, email_pronto):
        with patch(SEND) as enviar:
            resposta = client.post("/users/welcome-email", json={"email": "ninguem@example.com"}, headers=admin)
        assert resposta.status_code == 404
        enviar.assert_not_called()

    def test_sem_endereco_do_site_pede_para_preencher(self, client, admin, alvo, db_session):
        client.put("/settings/email/", json=SMTP, headers=admin)
        resposta = client.post("/users/welcome-email", json={"email": "alvo@example.com"}, headers=admin)
        assert resposta.status_code == 400
        assert "site" in resposta.json()["detail"]


class TestListaDePessoas:
    def test_lista_traz_a_foto_de_perfil(self, client, admin, alvo, db_session):
        from app.models.user import User

        db_session.query(User).filter(User.id == alvo).update({"picture_url": "/static/uploads/avatar-9.jpg"})
        db_session.commit()
        lista = {u["id"]: u for u in client.get("/users/", headers=admin).json()}
        assert lista[alvo]["picture_url"] == "/static/uploads/avatar-9.jpg"
        assert all(u["picture_url"] is None for i, u in lista.items() if i != alvo)

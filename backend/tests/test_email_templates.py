"""Os e-mails que o sistema escreve: texto padrao e personalizado, variaveis, layout HTML com a marca, previa e teste."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.core import email_templates as templates
from app.core.email_sender import Attachment, EmailError, SmtpConfig, build_message
from app.models.audit_log import AuditLog
from app.models.email_template import EmailTemplate
from app.models.settings import AppSettings
from app.routers.users import RESET_TOKEN_EXPIRE_MINUTES

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
SEND_ACCOUNT = "app.core.account_emails.send_email"
SEND_TEMPLATES = "app.routers.email_templates.send_email"
BRAND = templates.Brand(company="Acme", primary="#1E3A6B", logo_url="https://bi.exemplo.test/static/uploads/l.png", support_email=None)


def _entrar(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    resposta = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    return {"Authorization": f"Bearer {resposta.json()['access_token']}"}


@pytest.fixture
def admin(client):
    return _entrar(client, "admin@example.com")


@pytest.fixture
def pronto(client, admin, db_session):
    """Servidor de e-mail configurado e endereco do site preenchido."""
    assert client.put("/settings/email/", json=SMTP, headers=admin).status_code == 200
    row = db_session.query(AppSettings).filter(AppSettings.id == 1).first()
    row.site_url = "bi.exemplo.test"
    db_session.commit()


class TestRegras:
    def test_paragrafo_com_variavel_vazia_some(self):
        paragrafos = templates.render_paragraphs("Oi.\n\nMotivo: {motivo}\n\nTchau.", {"motivo": ""})
        assert paragrafos == ["Oi.", "Tchau."]
        assert templates.render_paragraphs("Oi.\n\nMotivo: {motivo}", {"motivo": "Fecha amanha"}) == ["Oi.", "Motivo: Fecha amanha"]

    def test_variavel_so_com_espacos_tambem_conta_como_vazia(self):
        assert templates.render_paragraphs("Motivo: {motivo}", {"motivo": "   "}) == []

    def test_quebra_de_linha_dentro_do_paragrafo_e_mantida(self):
        assert templates.render_paragraphs("Linha 1\nLinha 2\n\nOutro", {}) == ["Linha 1\nLinha 2", "Outro"]

    def test_assunto_fica_em_uma_linha_so(self):
        assert templates.render_subject("Oi {nome}", {"nome": "Ana\r\nBcc: x@y.com"}) == "Oi Ana Bcc: x@y.com"

    def test_variavel_desconhecida_e_recusada_dizendo_quais_existem(self):
        with pytest.raises(templates.TemplateError) as erro:
            templates.validate_texts("reset", "Oi {nome_errado}", None, None)
        assert "{nome_errado}" in str(erro.value) and "{minutos}" in str(erro.value)

    def test_limites_de_tamanho(self):
        with pytest.raises(templates.TemplateError):
            templates.validate_texts("reset", "a" * (templates.SUBJECT_MAX + 1), None, None)
        with pytest.raises(templates.TemplateError):
            templates.validate_texts("reset", None, "a" * (templates.BODY_MAX + 1), None)
        with pytest.raises(templates.TemplateError):
            templates.validate_texts("reset", None, None, "a" * (templates.BUTTON_MAX + 1))
        templates.validate_texts("reset", "a" * templates.SUBJECT_MAX, "a" * templates.BODY_MAX, "a" * templates.BUTTON_MAX)

    def test_todo_padrao_so_usa_variaveis_que_o_proprio_email_tem(self):
        for definicao in templates.CATALOG.values():
            templates.validate_texts(definicao.key, definicao.subject, definicao.body, definicao.button)

    def test_o_catalogo_tem_os_nove_emails(self):
        assert set(templates.CATALOG) == {
            "added", "invited", "reset", "extension_request", "extension_approved", "extension_denied",
            "subscription_paused", "alert_triggered", "test",
        }


class TestHtml:
    def _render(self, key="reset", valores=None, brand=BRAND, url="https://bi.exemplo.test/reset-password?token=abc&x=1"):
        definicao = templates.CATALOG[key]
        textos = templates.Effective(definicao.subject, definicao.body, definicao.button)
        base = {"saudacao": "Olá, Ana.", "empresa": brand.company, "minutos": "60"}
        return templates.render(textos, {**base, **(valores or {})}, brand, url)

    def test_leva_a_marca_o_botao_e_o_rodape(self):
        html = self._render().html
        assert "Acme" in html and "#1E3A6B" in html
        assert 'src="https://bi.exemplo.test/static/uploads/l.png"' in html
        assert "Criar senha nova" in html
        assert "Mensagem automática do Acme." in html

    def test_sem_logo_mostra_o_nome_da_empresa(self):
        marca = templates.Brand(company="Acme", primary="#1E3A6B", logo_url=None, support_email="ajuda@acme.test")
        html = self._render(brand=marca).html
        assert "<img" not in html
        assert "Dúvidas: ajuda@acme.test." in html

    def test_texto_digitado_nunca_vira_html(self):
        html = self._render(valores={"saudacao": "<script>alert(1)</script>"}).html
        assert "<script>" not in html
        assert "&lt;script&gt;" in html

    def test_nome_da_empresa_e_escapado(self):
        marca = templates.Brand(company='Acme <b>"x"</b>', primary="#1E3A6B", logo_url=None, support_email=None)
        html = self._render(brand=marca).html
        assert "<b>" not in html
        assert "Acme &lt;b&gt;" in html

    def test_endereco_do_botao_e_escapado_no_html_e_inteiro_no_texto(self):
        resultado = self._render()
        assert "token=abc&amp;x=1" in resultado.html
        assert "Criar senha nova: https://bi.exemplo.test/reset-password?token=abc&x=1" in resultado.text

    def test_email_sem_botao_nao_mostra_botao_nem_endereco(self):
        resultado = self._render(key="extension_denied", valores={"motivo": "Fecha amanha"}, url=None)
        assert "<a " not in resultado.html
        assert "Se o botão não abrir" not in resultado.html
        assert "Motivo: Fecha amanha" in resultado.html

    def test_cor_do_texto_do_botao_acompanha_a_cor_da_marca(self):
        escura = self._render(brand=templates.Brand("Acme", "#1E3A6B", None, None)).html
        clara = self._render(brand=templates.Brand("Acme", "#FDE68A", None, None)).html  # paleta_guard: ignore
        assert "color:#ffffff;text-decoration:none" in escura
        assert "color:#1f2937;text-decoration:none" in clara  # paleta_guard: ignore

    def test_marca_a_partir_das_configuracoes(self):
        linha = SimpleNamespace(company_name="  Acme  ", primary_color="#065F46", logo_url="/static/uploads/l.png", support_email=" a@b.c ")  # paleta_guard: ignore
        marca = templates.brand_from_settings(linha, "https://bi.exemplo.test")
        assert (marca.company, marca.primary, marca.logo_url, marca.support_email) == ("Acme", "#065F46", "https://bi.exemplo.test/static/uploads/l.png", "a@b.c")  # paleta_guard: ignore
        # Sem endereco do site a logo nao entra (e-mail nao carrega imagem de caminho relativo) e cor ruim volta ao padrao
        sem_site = templates.brand_from_settings(SimpleNamespace(company_name=None, primary_color="azul", logo_url="/x.png", support_email=None), None)
        assert (sem_site.company, sem_site.primary, sem_site.logo_url) == ("BIHoster", "#1E3A6B", None)


class TestMensagem:
    CONFIG = SmtpConfig("h", 587, "starttls", None, None, "de@exemplo.com", "Acme")

    def test_sem_html_continua_texto_puro(self):
        mensagem = build_message(self.CONFIG, ["a@x.com"], "Oi", "corpo")
        assert mensagem.get_content_type() == "text/plain"

    def test_com_html_leva_as_duas_versoes(self):
        mensagem = build_message(self.CONFIG, ["a@x.com"], "Oi", "corpo", html="<p>oi</p>")
        assert mensagem.get_content_type() == "multipart/alternative"
        assert [parte.get_content_type() for parte in mensagem.iter_parts()] == ["text/plain", "text/html"]

    def test_com_html_e_anexo_o_anexo_segue_valendo(self):
        mensagem = build_message(self.CONFIG, ["a@x.com"], "Oi", "corpo", [Attachment("r.pdf", b"%PDF", "application/pdf")], html="<p>oi</p>")
        assert mensagem.get_content_type() == "multipart/mixed"
        assert [anexo.get_filename() for anexo in mensagem.iter_attachments()] == ["r.pdf"]


class TestApi:
    def test_lista_os_nove_com_o_padrao_e_sem_personalizacao(self, client, admin):
        itens = client.get("/settings/email/templates/", headers=admin).json()
        assert [i["key"] for i in itens] == list(templates.CATALOG)
        reset = next(i for i in itens if i["key"] == "reset")
        assert reset["customized"] is False and reset["subject"] is None
        assert reset["default_subject"] == "Redefinição de senha - {empresa}"
        assert reset["has_button"] is True and reset["default_button"] == "Criar senha nova"
        assert {v["name"] for v in reset["variables"]} == {"saudacao", "empresa", "minutos"}
        assert next(i for i in itens if i["key"] == "extension_denied")["has_button"] is False

    def test_so_quem_tem_o_item_de_e_mail_acessa(self, client, admin):
        comum = _entrar(client, "comum@example.com")
        assert client.get("/settings/email/templates/", headers=comum).status_code == 403
        assert client.put("/settings/email/templates/reset", json={"subject": "x"}, headers=comum).status_code == 403
        assert client.post("/settings/email/templates/reset/preview", json={}, headers=comum).status_code == 403
        assert client.delete("/settings/email/templates/reset", headers=comum).status_code == 403
        com_item = _entrar(client, "email@example.com")
        pessoa = next(u["id"] for u in client.get("/users/", headers=admin).json() if u["email"] == "email@example.com")
        client.put(f"/access/users/{pessoa}", json={"blocks": [{"workspace_id": None, "permissions": ["sistema.email"]}]}, headers=admin)
        assert client.get("/settings/email/templates/", headers=com_item).status_code == 200

    def test_grava_e_a_lista_devolve(self, client, admin, db_session):
        corpo = {"subject": "Nova senha - {empresa}", "body": "{saudacao}\n\nUse o botão.", "button": "Trocar a senha"}
        resposta = client.put("/settings/email/templates/reset", json=corpo, headers=admin)
        assert resposta.status_code == 200
        assert resposta.json()["subject"] == corpo["subject"] and resposta.json()["customized"] is True
        item = next(i for i in client.get("/settings/email/templates/", headers=admin).json() if i["key"] == "reset")
        assert item["body"] == corpo["body"] and item["button"] == "Trocar a senha"
        assert db_session.query(AuditLog).filter(AuditLog.action == "update_email_template").count() == 1

    def test_campo_em_branco_volta_ao_padrao_e_tudo_em_branco_apaga_a_linha(self, client, admin, db_session):
        client.put("/settings/email/templates/reset", json={"subject": "Nova senha", "body": "Oi {saudacao}"}, headers=admin)
        parcial = client.put("/settings/email/templates/reset", json={"subject": "Nova senha", "body": "   "}, headers=admin).json()
        assert parcial["subject"] == "Nova senha" and parcial["body"] is None
        vazio = client.put("/settings/email/templates/reset", json={"subject": "", "body": None}, headers=admin).json()
        assert vazio["customized"] is False
        assert db_session.query(EmailTemplate).count() == 0

    def test_variavel_desconhecida_e_tamanho_dao_400_e_nao_gravam(self, client, admin, db_session):
        erro = client.put("/settings/email/templates/reset", json={"subject": "Oi {nome_errado}"}, headers=admin)
        assert erro.status_code == 400 and "{nome_errado}" in erro.json()["detail"]
        longo = client.put("/settings/email/templates/reset", json={"body": "a" * (templates.BODY_MAX + 1)}, headers=admin)
        assert longo.status_code == 400
        assert db_session.query(EmailTemplate).count() == 0

    def test_variavel_de_outro_email_nao_vale(self, client, admin):
        # {minutos} e do e-mail de redefinicao, nao do de teste
        assert client.put("/settings/email/templates/test", json={"body": "Vale {minutos} minutos"}, headers=admin).status_code == 400

    def test_email_inexistente_da_404(self, client, admin):
        assert client.put("/settings/email/templates/nao-existe", json={"subject": "x"}, headers=admin).status_code == 404
        assert client.delete("/settings/email/templates/nao-existe", headers=admin).status_code == 404
        assert client.post("/settings/email/templates/nao-existe/preview", json={}, headers=admin).status_code == 404

    def test_restaurar_apaga_a_personalizacao_e_registra(self, client, admin, db_session):
        client.put("/settings/email/templates/reset", json={"subject": "Nova senha"}, headers=admin)
        resposta = client.delete("/settings/email/templates/reset", headers=admin)
        assert resposta.status_code == 200 and resposta.json()["customized"] is False
        assert db_session.query(EmailTemplate).count() == 0
        assert db_session.query(AuditLog).filter(AuditLog.action == "reset_email_template").count() == 1
        # Restaurar o que ja esta no padrao nao registra de novo
        client.delete("/settings/email/templates/reset", headers=admin)
        assert db_session.query(AuditLog).filter(AuditLog.action == "reset_email_template").count() == 1

    def test_botao_de_email_sem_botao_e_ignorado(self, client, admin):
        resposta = client.put("/settings/email/templates/test", json={"button": "Clique"}, headers=admin).json()
        assert resposta["button"] is None

    def test_previa_usa_o_rascunho_sem_salvar(self, client, admin, db_session):
        resposta = client.post(
            "/settings/email/templates/reset/preview",
            json={"subject": "Prévia de {empresa}", "body": "{saudacao}\n\nLink válido por {minutos} min.", "button": "Abrir"},
            headers=admin,
        ).json()
        assert resposta["subject"] == "Prévia de BIHoster"
        assert "Link válido por 60 min." in resposta["html"] and "Olá, Maria da Silva." in resposta["html"]
        assert ">Abrir</a>" in resposta["html"]
        assert db_session.query(EmailTemplate).count() == 0

    def test_previa_em_branco_mostra_o_padrao(self, client, admin):
        resposta = client.post("/settings/email/templates/reset/preview", json={}, headers=admin).json()
        assert resposta["subject"] == "Redefinição de senha - BIHoster"
        assert "Criar senha nova" in resposta["html"]

    def test_previa_segue_a_marca_de_hoje(self, client, admin, db_session):
        client.put("/settings/", json={"company_name": "Acme", "primary_color": "#065F46"}, headers=admin)  # paleta_guard: ignore
        row = db_session.query(AppSettings).filter(AppSettings.id == 1).first()
        row.site_url = "bi.exemplo.test"
        row.logo_url = "/static/uploads/minha-marca.png"
        db_session.commit()
        html = client.post("/settings/email/templates/added/preview", json={}, headers=admin).json()["html"]
        assert "#065F46" in html and "Acme" in html  # paleta_guard: ignore
        assert 'src="https://bi.exemplo.test/static/uploads/minha-marca.png"' in html
        assert "https://bi.exemplo.test/login" in html

    def test_previa_com_variavel_errada_da_400(self, client, admin):
        assert client.post("/settings/email/templates/reset/preview", json={"body": "{x}"}, headers=admin).status_code == 400

    def test_previa_escapa_o_que_foi_digitado(self, client, admin):
        html = client.post("/settings/email/templates/reset/preview", json={"body": "<img src=x onerror=alert(1)> {saudacao}"}, headers=admin).json()["html"]
        assert "<img src=x" not in html and "&lt;img src=x" in html

    def test_teste_manda_html_e_texto_com_o_rascunho(self, client, admin, pronto):
        with patch(SEND_TEMPLATES) as enviar:
            resposta = client.post(
                "/settings/email/templates/reset/test",
                json={"to": "alvo@exemplo.com", "subject": "Rascunho {empresa}", "body": "{saudacao}\n\nOi."},
                headers=admin,
            )
        assert resposta.status_code == 200
        config, destinos = enviar.call_args.args[0], enviar.call_args.args[1]
        assert destinos == ["alvo@exemplo.com"] and config.host == "smtp.exemplo.test"
        assert enviar.call_args.kwargs["subject"] == "[Teste] Rascunho BIHoster"
        assert "Oi." in enviar.call_args.kwargs["body"] and "<html" in enviar.call_args.kwargs["html"]

    def test_teste_sem_servidor_configurado_da_400(self, client, admin):
        resposta = client.post("/settings/email/templates/reset/test", json={"to": "alvo@exemplo.com"}, headers=admin)
        assert resposta.status_code == 400 and "Configure" in resposta.json()["detail"]

    def test_teste_fora_dos_dominios_permitidos_nao_envia(self, client, admin, pronto):
        client.put("/settings/email/", json={"email_allowed_domains": "empresa.com"}, headers=admin)
        with patch(SEND_TEMPLATES) as enviar:
            resposta = client.post("/settings/email/templates/reset/test", json={"to": "x@gmail.com"}, headers=admin)
        assert resposta.status_code == 400
        enviar.assert_not_called()

    def test_falha_do_servidor_vira_502(self, client, admin, pronto):
        with patch(SEND_TEMPLATES, side_effect=EmailError("O servidor recusou o usuario ou a senha do SMTP.")):
            resposta = client.post("/settings/email/templates/reset/test", json={"to": "a@x.com"}, headers=admin)
        assert resposta.status_code == 502
        assert "segredo-smtp" not in resposta.text

    def test_limite_de_testes_por_minuto(self, client, admin, pronto):
        with patch(SEND_TEMPLATES):
            codigos = [client.post("/settings/email/templates/reset/test", json={"to": "a@x.com"}, headers=admin).status_code for _ in range(6)]
        assert codigos == [200, 200, 200, 200, 200, 429]


class TestNoEnvioDeVerdade:
    """O texto salvo vale nos e-mails que o sistema manda de verdade, em HTML e em texto puro."""

    @pytest.fixture
    def alvo(self, client, admin):
        _entrar(client, "alvo@example.com")
        return next(u["id"] for u in client.get("/users/", headers=admin).json() if u["email"] == "alvo@example.com")

    def test_sem_personalizar_leva_html_com_marca_e_o_texto_de_sempre(self, client, admin, alvo, pronto):
        with patch(SEND_ACCOUNT) as enviar:
            assert client.post(f"/users/{alvo}/send-reset-email", headers=admin).status_code == 200
        _, destinos, assunto, corpo = enviar.call_args.args
        html = enviar.call_args.kwargs["html"]
        assert destinos == ["alvo@example.com"] and assunto == "Redefinição de senha - BIHoster"
        assert "https://bi.exemplo.test/reset-password?token=" in corpo and "https://bi.exemplo.test/reset-password?token=" in html
        assert f"O link vale por {RESET_TOKEN_EXPIRE_MINUTES} minutos" in corpo and "Criar senha nova" in html

    def test_texto_personalizado_vale_no_envio(self, client, admin, alvo, pronto):
        client.put(
            "/settings/email/templates/reset",
            json={"subject": "Nova senha para {saudacao}", "body": "{saudacao}\n\nClique e troque. Vale {minutos} min.", "button": "Trocar agora"},
            headers=admin,
        )
        with patch(SEND_ACCOUNT) as enviar:
            client.post(f"/users/{alvo}/send-reset-email", headers=admin)
        _, _, assunto, corpo = enviar.call_args.args
        assert assunto == "Nova senha para Olá, Alvo."
        assert f"Clique e troque. Vale {RESET_TOKEN_EXPIRE_MINUTES} min." in corpo and "Trocar agora: https://bi.exemplo.test/reset-password?token=" in corpo
        assert ">Trocar agora</a>" in enviar.call_args.kwargs["html"]

    def test_convite_sem_conta_e_com_conta_sao_modelos_separados(self, client, admin, alvo, pronto):
        client.put("/settings/email/templates/added", json={"subject": "Com conta"}, headers=admin)
        client.put("/settings/email/templates/invited", json={"subject": "Sem conta"}, headers=admin)
        client.post("/groups/", json={"name": "G"}, headers=admin)
        grupo = next(g["id"] for g in client.get("/groups/", headers=admin).json() if g["name"] == "G")
        client.post(f"/groups/{grupo}/invite", json={"email": "novo@example.com"}, headers=admin)
        with patch(SEND_ACCOUNT) as enviar:
            client.post("/users/welcome-email", json={"email": "alvo@example.com"}, headers=admin)
            assert enviar.call_args.args[2] == "Com conta"
            client.post("/users/welcome-email", json={"email": "novo@example.com"}, headers=admin)
            assert enviar.call_args.args[2] == "Sem conta"
            assert "novo@example.com" in enviar.call_args.args[3]

    def test_aviso_do_google_so_aparece_com_o_login_ligado(self, client, admin, alvo, pronto, db_session):
        with patch(SEND_ACCOUNT) as enviar:
            client.post("/users/welcome-email", json={"email": "alvo@example.com"}, headers=admin)
        assert "botão do Google" not in enviar.call_args.args[3]
        row = db_session.query(AppSettings).filter(AppSettings.id == 1).first()
        row.google_oauth_enabled = True
        db_session.commit()
        with patch(SEND_ACCOUNT) as enviar:
            client.post("/users/welcome-email", json={"email": "alvo@example.com"}, headers=admin)
        assert "botão do Google" in enviar.call_args.args[3]

    def test_email_de_teste_do_servidor_usa_o_modelo_de_teste(self, client, admin, pronto):
        client.put("/settings/email/templates/test", json={"subject": "Funcionou - {empresa}"}, headers=admin)
        with patch("app.routers.email_settings.send_email") as enviar:
            assert client.post("/settings/email/test", json={"to": "alvo@exemplo.com"}, headers=admin).status_code == 200
        assert enviar.call_args.kwargs["subject"] == "Funcionou - BIHoster"
        assert "<html" in enviar.call_args.kwargs["html"]


class TestAlertaEPausa:
    """Os dois modelos novos: o aviso de assinatura pausada e o alerta de medida."""

    def _alerta(self, **extra):
        from types import SimpleNamespace as NS

        base = dict(
            condition=">", measure_name="Total de vendas", threshold=1000.0, subject=None, message=None,
            created_by_name="Maria da Silva", recipients=["gestor@empresa.com"],
        )
        base.update(extra)
        return NS(**base)

    def _enviar(self, db_session, alerta):
        from app.core import alert_runner
        from app.core.email_sender import SmtpConfig

        linha = db_session.query(AppSettings).filter(AppSettings.id == 1).first() or AppSettings(id=1)
        smtp = SmtpConfig("h", 587, "starttls", None, None, "de@exemplo.com", None)
        with patch("app.core.email_sender.send_email") as enviar:
            alert_runner._send_alert_email(db_session, linha, smtp, alerta, "Vendas do mês", 1250.0)
        return enviar

    def test_alerta_usa_o_texto_padrao_em_html(self, db_session):
        enviar = self._enviar(db_session, self._alerta())

        _, destinos, assunto, corpo = enviar.call_args.args
        assert destinos == ["gestor@empresa.com"]
        assert assunto == "[Alerta] Total de vendas maior que 1000 - Vendas do mês"
        assert "Medida: Total de vendas" in corpo and "Valor: 1250" in corpo and "Condição: maior que 1000" in corpo
        assert "Alerta configurado por Maria da Silva no BIHoster." in corpo
        assert "Total de vendas" in enviar.call_args.kwargs["html"]

    def test_mensagem_do_alerta_aparece_e_some_quando_vazia(self, db_session):
        com = self._enviar(db_session, self._alerta(message="Confira com o comercial.")).call_args.args[3]
        sem = self._enviar(db_session, self._alerta()).call_args.args[3]
        assert "Confira com o comercial." in com
        assert "Confira com o comercial." not in sem
        assert "\n\n\n" not in sem

    def test_assunto_proprio_do_alerta_vale_no_lugar_do_modelo(self, db_session):
        enviar = self._enviar(db_session, self._alerta(subject="Vendas passaram da meta"))
        assert enviar.call_args.args[2] == "Vendas passaram da meta"

    def test_texto_editado_na_aba_email_vale_para_o_alerta(self, db_session):
        db_session.add(EmailTemplate(key="alert_triggered", subject="Meta batida: {medida}", body="{medida} chegou a {valor}."))
        db_session.commit()

        enviar = self._enviar(db_session, self._alerta())

        _, _, assunto, corpo = enviar.call_args.args
        assert assunto == "Meta batida: Total de vendas"
        assert "Total de vendas chegou a 1250." in corpo

    def test_os_dois_modelos_novos_aparecem_na_lista_com_as_variaveis(self, client, admin):
        itens = {i["key"]: i for i in client.get("/settings/email/templates/", headers=admin).json()}
        assert {v["name"] for v in itens["alert_triggered"]["variables"]} >= {"medida", "valor", "condicao", "limite", "relatorio", "mensagem", "criador"}
        assert {v["name"] for v in itens["subscription_paused"]["variables"]} == {"empresa", "relatorio", "motivo"}
        assert itens["alert_triggered"]["has_button"] is False and itens["subscription_paused"]["has_button"] is False

    def test_previa_do_alerta_mostra_os_valores_de_exemplo(self, client, admin):
        html = client.post("/settings/email/templates/alert_triggered/preview", json={}, headers=admin).json()["html"]
        assert "Total de vendas" in html and "Confira com o time comercial." in html

    def test_previa_da_pausa_nao_leva_botao(self, client, admin):
        html = client.post("/settings/email/templates/subscription_paused/preview", json={}, headers=admin).json()["html"]
        assert "<a " not in html and "O servidor recusou o usuário ou a senha." in html

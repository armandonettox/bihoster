"""Rotas das assinaturas de relatorio: permissao (admin, editor da colecao, leitor, outra colecao),
validacao, criacao/edicao/pausa/exclusao, envio manual e historico. Power BI e SMTP sao simulados."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.core import powerbi, report_delivery, subscription_runner
from app.models.audit_log import AuditLog
from app.models.subscription import ReportSubscription, SubscriptionRun

PASSWORD = "SenhaForte123"
PAYLOAD = {
    "name": "Semanal",
    "recipients": ["gestor@empresa.com"],
    "format": "PDF",
    "days": [0, 2, 4],
    "times": ["08:00"],
}


def _headers(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _pbi(rls=False):
    return (
        patch.object(powerbi, "get_report_details", return_value={"embedUrl": "https://embed/x"}),
        patch.object(powerbi, "dataset_requires_effective_identity", return_value=rls),
    )


@pytest.fixture
def cenario(client):
    """admin; `pessoa` (comum) e EDITORA na colecao A e LEITORA na B; um relatorio em cada colecao;
    e-mail configurado com dominios permitidos."""
    admin = _headers(client, "admin@empresa.com")
    client.put(
        "/settings/email/",
        json={"smtp_host": "smtp.x", "smtp_from_email": "relatorios@empresa.com", "email_allowed_domains": "empresa.com"},
        headers=admin,
    )
    conn = client.post(
        "/powerbi-connections/", json={"name": "C", "tenant_id": "t", "client_id": "c", "client_secret": "s"}, headers=admin
    ).json()
    pessoa = _headers(client, "pessoa@empresa.com")

    def colecao(nome, papel):
        ws = client.post("/workspaces/", json={"name": nome}, headers=admin).json()
        acessos = client.get(f"/workspaces/{ws['id']}/access", headers=admin).json()
        padrao = next(a for a in acessos if a["is_default"])
        client.put(f"/workspaces/{ws['id']}/access/{padrao['group_id']}", json={"role": papel}, headers=admin)
        rel = client.post(
            f"/workspaces/{ws['id']}/reports/",
            json={"name": f"Relatorio {nome}", "powerbi_connection_id": conn["id"], "pbi_workspace_id": "pbi-ws",
                  "pbi_report_id": f"pbi-{nome}", "pbi_dataset_id": "ds-1"},
            headers=admin,
        ).json()
        return ws, rel

    ws_a, rel_a = colecao("A", "editor")
    ws_b, rel_b = colecao("B", "viewer")
    return SimpleNamespace(admin=admin, pessoa=pessoa, ws_a=ws_a, rel_a=rel_a, ws_b=ws_b, rel_b=rel_b)


def _url_rel(ws, rel):
    return f"/workspaces/{ws['id']}/reports/{rel['id']}/subscriptions"


def _criar(client, c, headers=None, ws=None, rel=None, **extra):
    p1, p2 = _pbi()
    with p1, p2:
        return client.post(
            _url_rel(ws or c.ws_a, rel or c.rel_a), json={**PAYLOAD, **extra}, headers=headers or c.admin
        )


class TestPermissao:
    def test_administrador_cria_em_qualquer_colecao(self, client, cenario):
        assert _criar(client, cenario).status_code == 201
        assert _criar(client, cenario, ws=cenario.ws_b, rel=cenario.rel_b).status_code == 201

    def test_editor_da_colecao_cria_na_colecao_dele(self, client, cenario):
        resp = _criar(client, cenario, headers=cenario.pessoa)

        assert resp.status_code == 201
        assert resp.json()["created_by_name"] == "pessoa"

    def test_leitor_da_colecao_nao_cria_nem_ve(self, client, cenario):
        resp = _criar(client, cenario, headers=cenario.pessoa, ws=cenario.ws_b, rel=cenario.rel_b)

        assert resp.status_code == 403
        assert client.get(_url_rel(cenario.ws_b, cenario.rel_b), headers=cenario.pessoa).status_code == 403
        assert client.get(f"/workspaces/{cenario.ws_b['id']}/subscriptions", headers=cenario.pessoa).status_code == 403

    def test_o_mesmo_usuario_e_editor_numa_colecao_e_leitor_noutra(self, client, cenario):
        assert _criar(client, cenario, headers=cenario.pessoa).status_code == 201
        assert _criar(client, cenario, headers=cenario.pessoa, ws=cenario.ws_b, rel=cenario.rel_b).status_code == 403

    def test_leitor_nao_mexe_em_assinatura_existente(self, client, cenario):
        sub = _criar(client, cenario, ws=cenario.ws_b, rel=cenario.rel_b).json()
        base = f"/workspaces/{cenario.ws_b['id']}/subscriptions/{sub['id']}"

        assert client.get(base, headers=cenario.pessoa).status_code == 403
        assert client.put(base, json={"enabled": False}, headers=cenario.pessoa).status_code == 403
        assert client.delete(base, headers=cenario.pessoa).status_code == 403
        assert client.post(base + "/run", headers=cenario.pessoa).status_code == 403
        assert client.get(base + "/runs", headers=cenario.pessoa).status_code == 403

    def test_editor_de_uma_colecao_nao_alcanca_a_assinatura_de_outra_trocando_o_endereco(self, client, cenario):
        sub_b = _criar(client, cenario, ws=cenario.ws_b, rel=cenario.rel_b).json()
        # A pessoa e editora da A: usa o id da colecao A com o id da assinatura da B
        base = f"/workspaces/{cenario.ws_a['id']}/subscriptions/{sub_b['id']}"

        assert client.get(base, headers=cenario.pessoa).status_code == 404
        assert client.put(base, json={"enabled": False}, headers=cenario.pessoa).status_code == 404
        assert client.delete(base, headers=cenario.pessoa).status_code == 404
        assert client.get(base + "/runs", headers=cenario.pessoa).status_code == 404
        assert client.get(f"/workspaces/{cenario.ws_a['id']}/reports/{cenario.rel_b['id']}/subscriptions", headers=cenario.pessoa).status_code == 404

    def test_sem_login_nada_funciona(self, client, cenario):
        assert client.get(f"/workspaces/{cenario.ws_a['id']}/subscriptions").status_code == 401
        assert client.post(_url_rel(cenario.ws_a, cenario.rel_a), json=PAYLOAD).status_code == 401
        assert client.get("/subscriptions/").status_code == 401

    def test_editor_so_cria_quando_a_lista_de_dominios_existe(self, client, cenario):
        client.put("/settings/email/", json={"email_allowed_domains": ""}, headers=cenario.admin)

        sem_lista = _criar(client, cenario, headers=cenario.pessoa)
        admin_sem_lista = _criar(client, cenario)

        assert sem_lista.status_code == 403 and "dominios permitidos" in sem_lista.json()["detail"]
        assert admin_sem_lista.status_code == 201  # administrador nao depende da lista

    def test_visao_geral_so_para_administrador(self, client, cenario):
        _criar(client, cenario)
        _criar(client, cenario, ws=cenario.ws_b, rel=cenario.rel_b)

        todas = client.get("/subscriptions/", headers=cenario.admin)
        negado = client.get("/subscriptions/", headers=cenario.pessoa)

        assert [s["collection_name"] for s in todas.json()] == ["A", "B"]
        assert negado.status_code == 403


class TestCriacao:
    def test_devolve_tudo_e_ja_calcula_o_proximo_envio(self, client, cenario):
        resp = _criar(client, cenario)

        assert resp.status_code == 201
        s = resp.json()
        assert (s["format"], s["days"], s["times"], s["enabled"]) == ("PDF", [0, 2, 4], ["08:00"], True)
        assert s["schedule_text"] == "seg, qua, sex as 08:00"
        assert s["report_name"] == "Relatorio A" and s["collection_name"] == "A"
        assert s["timezone"] == "America/Sao_Paulo"  # o fuso das Configuracoes
        assert s["consecutive_failures"] == 0 and s["last_status"] is None
        proximo = datetime.fromisoformat(s["next_run_at"].replace("Z", "+00:00"))
        assert proximo > datetime.now(timezone.utc)
        assert proximo.minute == 0 and proximo.hour == 11  # 08:00 em Sao Paulo = 11:00 UTC

    def test_destinatarios_sao_normalizados_e_sem_repeticao(self, client, cenario):
        resp = _criar(client, cenario, recipients=[" Gestor@Empresa.com ", "gestor@empresa.com", "outro@empresa.com"])

        assert resp.json()["recipients"] == ["gestor@empresa.com", "outro@empresa.com"]

    def test_aceita_imagem_png_e_varios_horarios(self, client, cenario):
        resp = _criar(client, cenario, format="PNG", times=["17:30", "08:00"])

        assert resp.json()["format"] == "PNG" and resp.json()["times"] == ["08:00", "17:30"]

    def test_assunto_e_mensagem_personalizados(self, client, cenario):
        resp = _criar(client, cenario, subject="Resultado\r\nBcc: x@y.com", message="  Segue o fechamento.  ")

        assert resp.json()["subject"] == "Resultado Bcc: x@y.com"  # sem quebra de linha: seria injecao de cabecalho
        assert resp.json()["message"] == "Segue o fechamento."

    @pytest.mark.parametrize(
        "campo, valor",
        [
            ("recipients", []),
            ("recipients", ["nao-e-email"]),
            ("recipients", [f"p{i}@empresa.com" for i in range(21)]),
            ("format", "DOCX"),
            ("days", []),
            ("days", [7]),
            ("times", []),
            ("times", ["25:00"]),
            ("times", [f"{h:02d}:00" for h in range(7)]),
            ("timezone", "Marte/Olympus"),
            ("subject", "x" * 151),
            ("message", "x" * 1001),
            ("name", "x" * 121),
        ],
    )
    def test_entradas_invalidas_sao_recusadas(self, client, cenario, campo, valor):
        assert _criar(client, cenario, **{campo: valor}).status_code == 422

    def test_data_final_antes_da_inicial(self, client, cenario):
        assert _criar(client, cenario, start_date="2026-12-10", end_date="2026-12-01").status_code == 422

    def test_periodo_que_ja_terminou_nao_tem_proximo_envio(self, client, cenario):
        resp = _criar(client, cenario, end_date="2020-01-01")

        assert resp.status_code == 400 and "ja terminou" in resp.json()["detail"]

    def test_destinatario_fora_dos_dominios_permitidos(self, client, cenario):
        resp = _criar(client, cenario, recipients=["gestor@empresa.com", "x@gmail.com"])

        assert resp.status_code == 400 and "x@gmail.com" in resp.json()["detail"]

    def test_sem_servidor_de_email_configurado(self, client, cenario):
        client.put("/settings/email/", json={"smtp_host": ""}, headers=cenario.admin)

        resp = _criar(client, cenario)

        assert resp.status_code == 400 and "Configure o servidor de e-mail" in resp.json()["detail"]

    def test_relatorio_com_rls_e_recusado(self, client, cenario):
        p1, p2 = _pbi(rls=True)
        with p1, p2:
            resp = client.post(_url_rel(cenario.ws_a, cenario.rel_a), json=PAYLOAD, headers=cenario.admin)

        assert resp.status_code == 400 and "RLS" in resp.json()["detail"]

    def test_relatorio_de_outra_colecao_ou_inexistente(self, client, cenario):
        p1, p2 = _pbi()
        with p1, p2:
            resp = client.post(
                f"/workspaces/{cenario.ws_a['id']}/reports/9999/subscriptions", json=PAYLOAD, headers=cenario.admin
            )
            troca = client.post(_url_rel(cenario.ws_a, cenario.rel_b), json=PAYLOAD, headers=cenario.admin)

        assert resp.status_code == 404 and troca.status_code == 404

    def test_limite_de_assinaturas_por_relatorio(self, client, cenario):
        for _ in range(10):
            assert _criar(client, cenario).status_code == 201

        assert _criar(client, cenario).status_code == 400

    def test_nasce_pausada_quando_pedido_e_sem_proximo_envio(self, client, cenario):
        resp = _criar(client, cenario, enabled=False)

        assert resp.json()["enabled"] is False and resp.json()["next_run_at"] is None


class TestEdicaoPausaEExclusao:
    def _base(self, c, sub):
        return f"/workspaces/{c.ws_a['id']}/subscriptions/{sub['id']}"

    def test_trocar_horarios_recalcula_o_proximo_envio(self, client, cenario):
        sub = _criar(client, cenario).json()

        novo = client.put(self._base(cenario, sub), json={"times": ["23:30"], "days": [0, 1, 2, 3, 4, 5, 6]}, headers=cenario.admin).json()

        proximo = datetime.fromisoformat(novo["next_run_at"].replace("Z", "+00:00"))
        assert novo["times"] == ["23:30"] and novo["schedule_text"] == "todos os dias as 23:30"
        assert (proximo.hour, proximo.minute) == (2, 30)  # 23:30 em Sao Paulo = 02:30 UTC do dia seguinte

    def test_pausar_limpa_o_proximo_envio_e_reativar_volta_a_agendar(self, client, cenario):
        sub = _criar(client, cenario).json()

        pausada = client.put(self._base(cenario, sub), json={"enabled": False}, headers=cenario.admin).json()
        p1, p2 = _pbi()
        with p1, p2:
            reativada = client.put(self._base(cenario, sub), json={"enabled": True}, headers=cenario.admin).json()

        assert pausada["enabled"] is False and pausada["next_run_at"] is None
        assert reativada["enabled"] is True and reativada["next_run_at"] is not None

    def test_reativar_zera_as_falhas_seguidas(self, client, cenario, db_session):
        sub = _criar(client, cenario).json()
        linha = db_session.get(ReportSubscription, sub["id"])
        linha.enabled, linha.consecutive_failures, linha.next_run_at = False, 3, None
        db_session.commit()

        p1, p2 = _pbi()
        with p1, p2:
            reativada = client.put(self._base(cenario, sub), json={"enabled": True}, headers=cenario.admin).json()

        assert reativada["consecutive_failures"] == 0

    def test_reativar_exige_tudo_em_ordem_de_novo(self, client, cenario):
        sub = _criar(client, cenario, enabled=False).json()
        p1, p2 = _pbi(rls=True)  # o relatorio passou a ter RLS enquanto estava pausada

        with p1, p2:
            resp = client.put(self._base(cenario, sub), json={"enabled": True}, headers=cenario.admin)

        assert resp.status_code == 400 and "RLS" in resp.json()["detail"]

    def test_trocar_destinatarios_confere_os_dominios(self, client, cenario):
        sub = _criar(client, cenario).json()

        resp = client.put(self._base(cenario, sub), json={"recipients": ["x@gmail.com"]}, headers=cenario.admin)

        assert resp.status_code == 400

    def test_mudar_so_a_data_inicial_para_depois_da_final_ja_gravada(self, client, cenario):
        sub = _criar(client, cenario, start_date="2030-01-01", end_date="2030-06-30").json()

        resp = client.put(self._base(cenario, sub), json={"start_date": "2030-08-01"}, headers=cenario.admin)

        assert resp.status_code == 400 and "data final" in resp.json()["detail"]

    def test_campo_obrigatorio_nao_aceita_null_explicito(self, client, cenario):
        sub = _criar(client, cenario).json()

        assert client.put(self._base(cenario, sub), json={"recipients": None}, headers=cenario.admin).status_code == 422
        assert client.put(self._base(cenario, sub), json={"days": None}, headers=cenario.admin).status_code == 422

    def test_editor_sem_lista_de_dominios_nao_edita(self, client, cenario):
        sub = _criar(client, cenario).json()
        client.put("/settings/email/", json={"email_allowed_domains": ""}, headers=cenario.admin)

        resp = client.put(self._base(cenario, sub), json={"name": "Novo"}, headers=cenario.pessoa)

        assert resp.status_code == 403

    def test_editor_edita_a_assinatura_criada_por_outra_pessoa_da_mesma_colecao(self, client, cenario):
        sub = _criar(client, cenario).json()  # criada pelo admin

        resp = client.put(self._base(cenario, sub), json={"name": "Renomeada"}, headers=cenario.pessoa)

        assert resp.status_code == 200 and resp.json()["name"] == "Renomeada"

    def test_excluir_apaga_a_assinatura_e_o_historico(self, client, cenario, db_session):
        sub = _criar(client, cenario).json()
        db_session.add(SubscriptionRun(subscription_id=sub["id"], started_at=datetime.now(timezone.utc), status="ok", trigger="manual"))
        db_session.commit()

        resp = client.delete(self._base(cenario, sub), headers=cenario.admin)

        assert resp.status_code == 204
        assert db_session.query(ReportSubscription).count() == 0
        assert db_session.query(SubscriptionRun).count() == 0
        assert client.get(self._base(cenario, sub), headers=cenario.admin).status_code == 404

    def test_excluir_o_relatorio_apaga_as_assinaturas_dele(self, client, cenario, db_session):
        _criar(client, cenario)
        _criar(client, cenario, ws=cenario.ws_b, rel=cenario.rel_b)

        client.delete(f"/workspaces/{cenario.ws_a['id']}/reports/{cenario.rel_a['id']}", headers=cenario.admin)

        restantes = db_session.query(ReportSubscription).all()
        assert [s.report_id for s in restantes] == [cenario.rel_b["id"]]

    def test_excluir_a_colecao_apaga_as_assinaturas_dela(self, client, cenario, db_session):
        _criar(client, cenario)

        resp = client.delete(f"/workspaces/{cenario.ws_a['id']}", headers=cenario.admin)

        assert resp.status_code == 204
        assert db_session.query(ReportSubscription).count() == 0

    def test_listas_por_colecao_e_por_relatorio(self, client, cenario):
        _criar(client, cenario)
        _criar(client, cenario, name="Segunda")

        por_colecao = client.get(f"/workspaces/{cenario.ws_a['id']}/subscriptions", headers=cenario.admin).json()
        por_relatorio = client.get(_url_rel(cenario.ws_a, cenario.rel_a), headers=cenario.admin).json()

        assert len(por_colecao) == len(por_relatorio) == 2


class TestAuditoria:
    def test_criar_editar_e_excluir_ficam_registrados_sem_enderecos(self, client, cenario, db_session):
        sub = _criar(client, cenario, recipients=["gestor@empresa.com", "outro@empresa.com"]).json()
        base = f"/workspaces/{cenario.ws_a['id']}/subscriptions/{sub['id']}"
        client.put(base, json={"recipients": ["novo@empresa.com"], "name": "x"}, headers=cenario.admin)
        client.delete(base, headers=cenario.admin)

        logs = {l.action: l.details for l in db_session.query(AuditLog).filter(AuditLog.action.like("subscription_%"))}
        assert logs["subscription_created"] == "PDF, 2 destinatario(s), seg, qua, sex as 08:00"
        assert logs["subscription_updated"] == "name, recipients"
        assert "subscription_deleted" in logs
        todos = " ".join(l.details or "" for l in db_session.query(AuditLog))
        assert "@empresa.com" not in todos.replace("admin@empresa.com", "").replace("pessoa@empresa.com", "")


class TestEnvioManual:
    def _run(self, c, sub, headers=None):
        return f"/workspaces/{c.ws_a['id']}/subscriptions/{sub['id']}/run"

    def test_dispara_um_envio_manual_e_devolve_o_trabalho_para_acompanhar(self, client, cenario):
        sub = _criar(client, cenario).json()

        with patch.object(subscription_runner, "start_run_thread") as iniciar:
            resp = client.post(self._run(cenario, sub), headers=cenario.admin)

        assert resp.status_code == 202
        args, kwargs = iniciar.call_args
        assert args == (sub["id"], "manual") and kwargs["job"].id == resp.json()["job_id"]
        # O trabalho e acompanhado pela mesma rota do envio avulso
        status = client.get(
            f"/workspaces/{cenario.ws_a['id']}/powerbi/export-jobs/{resp.json()['job_id']}", headers=cenario.admin
        )
        assert status.status_code == 200

    def test_nao_dispara_se_ja_esta_enviando(self, client, cenario):
        sub = _criar(client, cenario).json()

        with patch.object(subscription_runner, "is_running", return_value=True), patch.object(
            subscription_runner, "start_run_thread"
        ) as iniciar:
            resp = client.post(self._run(cenario, sub), headers=cenario.admin)

        assert resp.status_code == 409
        iniciar.assert_not_called()

    def test_editor_sem_lista_de_dominios_nao_dispara(self, client, cenario):
        sub = _criar(client, cenario).json()
        client.put("/settings/email/", json={"email_allowed_domains": ""}, headers=cenario.admin)

        with patch.object(subscription_runner, "start_run_thread") as iniciar:
            resp = client.post(self._run(cenario, sub), headers=cenario.pessoa)

        assert resp.status_code == 403
        iniciar.assert_not_called()

    def test_limite_de_envios_manuais_por_minuto(self, client, cenario):
        sub = _criar(client, cenario).json()

        with patch.object(subscription_runner, "start_run_thread"):
            codigos = [client.post(self._run(cenario, sub), headers=cenario.admin).status_code for _ in range(6)]

        assert codigos == [202, 202, 202, 202, 202, 429]

    def test_o_pedido_fica_na_auditoria(self, client, cenario, db_session):
        sub = _criar(client, cenario).json()

        with patch.object(subscription_runner, "start_run_thread"):
            client.post(self._run(cenario, sub), headers=cenario.admin)

        assert db_session.query(AuditLog).filter(AuditLog.action == "subscription_run_requested").count() == 1


class TestHistorico:
    def test_lista_os_envios_do_mais_recente_para_o_mais_antigo(self, client, cenario, db_session):
        sub = _criar(client, cenario).json()
        base = datetime(2026, 11, 4, 11, 0, tzinfo=timezone.utc)
        for i, status in enumerate(["error", "ok", "skipped"]):
            db_session.add(SubscriptionRun(
                subscription_id=sub["id"], started_at=base + timedelta(days=i), status=status, trigger="schedule",
                attempts=1, message=f"m{i}", recipients_count=1,
            ))
        db_session.commit()

        runs = client.get(f"/workspaces/{cenario.ws_a['id']}/subscriptions/{sub['id']}/runs", headers=cenario.admin).json()

        assert [r["status"] for r in runs] == ["skipped", "ok", "error"]
        assert runs[0]["started_at"].endswith("Z")

    def test_mostra_so_os_ultimos_30(self, client, cenario, db_session):
        sub = _criar(client, cenario).json()
        base = datetime(2026, 11, 4, tzinfo=timezone.utc)
        for i in range(35):
            db_session.add(SubscriptionRun(subscription_id=sub["id"], started_at=base + timedelta(hours=i), status="ok", trigger="schedule"))
        db_session.commit()

        runs = client.get(f"/workspaces/{cenario.ws_a['id']}/subscriptions/{sub['id']}/runs", headers=cenario.admin).json()

        assert len(runs) == 30

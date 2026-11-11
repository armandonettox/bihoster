"""Cache do Power BI: token de embed compartilhado entre usuarios (sem RLS), info de atualizacao em
lote por colecao (cache por dataset) e aquecimento dos caches em segundo plano."""

import time
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.core import cache_warmup
from app.core import powerbi as powerbi_core
from app.routers import powerbi as embed_router

PASSWORD = "SenhaForte123"


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _token(valor: str = "tok", minutos: int = 60) -> dict:
    return {"token": valor, "expiration": _iso(datetime.now(timezone.utc) + timedelta(minutes=minutos))}


def _headers_de(client, email: str) -> dict:
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    resp = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _setup(client, datasets: list[str | None] | None = None):
    """Administrador, coleccao, conta e um relatorio por item de `datasets` (None = sem dataset).
    Devolve (headers do admin, colecao, [relatorios])."""
    admin = _headers_de(client, "admin@example.com")
    workspace = client.post("/workspaces/", json={"name": "Comercial"}, headers=admin).json()
    conn = client.post(
        "/powerbi-connections/",
        json={"name": "Conta", "tenant_id": "t1", "client_id": "c1", "client_secret": "s1"},
        headers=admin,
    ).json()
    reports = []
    for i, dataset in enumerate(datasets or [None]):
        body = {
            "name": f"Relatorio {i}",
            "powerbi_connection_id": conn["id"],
            "pbi_workspace_id": "pbi-ws",
            "pbi_report_id": f"pbi-rel-{i}",
        }
        if dataset:
            body["pbi_dataset_id"] = dataset
        reports.append(client.post(f"/workspaces/{workspace['id']}/reports/", json=body, headers=admin).json())
    return admin, workspace, reports


def _embed(client, headers, workspace, report, *, generate, rls=False):
    url = f"/workspaces/{workspace['id']}/powerbi/reports/{report['id']}/embed"
    with patch.object(powerbi_core, "get_report_details", return_value={"embedUrl": "https://embed/x"}), patch.object(
        powerbi_core, "dataset_requires_effective_identity", return_value=rls
    ), patch.object(powerbi_core, "generate_embed_token", generate):
        return client.get(url, headers=headers)


class TestTokenCompartilhado:
    def test_sem_rls_o_segundo_usuario_recebe_o_mesmo_token_sem_gerar_outro(self, client):
        admin, workspace, (report,) = _setup(client, ["ds-1"])
        outro = _headers_de(client, "pessoa@example.com")
        generate = MagicMock(return_value=_token("token-unico"))

        r1 = _embed(client, admin, workspace, report, generate=generate)
        r2 = _embed(client, outro, workspace, report, generate=generate)

        assert r1.status_code == r2.status_code == 200
        assert r1.json()["access_token"] == r2.json()["access_token"] == "token-unico"
        assert generate.call_count == 1

    def test_com_rls_cada_usuario_recebe_um_token_com_a_propria_identidade(self, client):
        admin, workspace, (report,) = _setup(client, ["ds-1"])
        outro = _headers_de(client, "pessoa@example.com")
        generate = MagicMock(side_effect=[_token("do-admin"), _token("da-pessoa")])

        r1 = _embed(client, admin, workspace, report, generate=generate, rls=True)
        r2 = _embed(client, outro, workspace, report, generate=generate, rls=True)

        assert r1.json()["access_token"] == "do-admin"
        assert r2.json()["access_token"] == "da-pessoa"
        usuarios = [call.kwargs["username"] for call in generate.call_args_list]
        assert usuarios == ["admin@example.com", "pessoa@example.com"]
        # Cada token fica na entrada do proprio usuario, nunca na compartilhada
        assert not [k for k in embed_router._embed_cache if k[2] is None]

    def test_quem_perdeu_o_acesso_a_colecao_nao_recebe_o_token_compartilhado(self, client):
        admin, workspace, (report,) = _setup(client, ["ds-1"])
        outro = _headers_de(client, "pessoa@example.com")
        generate = MagicMock(return_value=_token())
        assert _embed(client, admin, workspace, report, generate=generate).status_code == 200
        assert _embed(client, outro, workspace, report, generate=generate).status_code == 200

        # Tira o acesso do grupo padrao ("Todos os usuarios"): a pessoa deixa de ser membro
        acessos = client.get(f"/workspaces/{workspace['id']}/access", headers=admin).json()
        padrao = next(a for a in acessos if a["is_default"])
        client.delete(f"/workspaces/{workspace['id']}/access/{padrao['group_id']}", headers=admin)

        resp = _embed(client, outro, workspace, report, generate=generate)

        assert resp.status_code == 403
        assert "token" not in resp.text

    def test_editar_o_relatorio_descarta_o_token_compartilhado(self, client):
        admin, workspace, (report,) = _setup(client, ["ds-1"])
        generate = MagicMock(return_value=_token())
        _embed(client, admin, workspace, report, generate=generate)
        assert (workspace["id"], report["id"], None) in embed_router._embed_cache

        embed_router.invalidate_embed_cache(workspace["id"], report["id"])

        assert (workspace["id"], report["id"], None) not in embed_router._embed_cache


class TestInfoDeAtualizacaoEmLote:
    def _chama(self, client, headers, workspace, get_info):
        with patch.object(powerbi_core, "get_refresh_info", get_info):
            return client.get(f"/workspaces/{workspace['id']}/powerbi/refresh-info", headers=headers)

    def test_cada_dataset_e_consultado_uma_vez_mesmo_com_varios_relatorios(self, client):
        admin, workspace, reports = _setup(client, ["ds-1", "ds-1", "ds-2", None])
        info = MagicMock(side_effect=lambda conn, ws, ds: {"last_refresh": f"ultima-{ds}", "next_refresh": None})

        resp = self._chama(client, admin, workspace, info)

        assert resp.status_code == 200
        corpo = resp.json()
        assert set(corpo) == {str(r["id"]) for r in reports}
        assert corpo[str(reports[0]["id"])]["last_refresh"] == "ultima-ds-1"
        assert corpo[str(reports[1]["id"])]["last_refresh"] == "ultima-ds-1"
        assert corpo[str(reports[2]["id"])]["last_refresh"] == "ultima-ds-2"
        assert corpo[str(reports[3]["id"])] == {"last_refresh": None, "next_refresh": None, "last_status": None}
        assert info.call_count == 2

    def test_segunda_chamada_vem_do_cache(self, client):
        admin, workspace, _ = _setup(client, ["ds-1", "ds-2"])
        info = MagicMock(return_value={"last_refresh": "x", "next_refresh": None})

        self._chama(client, admin, workspace, info)
        self._chama(client, admin, workspace, info)

        assert info.call_count == 2  # 2 datasets, so na primeira chamada

    def test_falha_em_um_dataset_nao_derruba_a_colecao_e_nao_entra_no_cache(self, client):
        admin, workspace, (a, b) = _setup(client, ["ds-1", "ds-2"])

        def get_info(conn, ws, ds):
            if ds == "ds-2":
                raise powerbi_core.PowerBIError("indisponivel")
            return {"last_refresh": "ok", "next_refresh": None}

        resp = self._chama(client, admin, workspace, MagicMock(side_effect=get_info))

        assert resp.status_code == 200
        assert resp.json()[str(a["id"])]["last_refresh"] == "ok"
        assert resp.json()[str(b["id"])] == {"last_refresh": None, "next_refresh": None, "last_status": None}
        # O que falhou nao ficou guardado: a proxima chamada tenta de novo
        recupera = MagicMock(return_value={"last_refresh": "agora", "next_refresh": None})
        resp = self._chama(client, admin, workspace, recupera)
        assert resp.json()[str(b["id"])]["last_refresh"] == "agora"
        assert recupera.call_count == 1

    def test_exige_acesso_a_colecao(self, client):
        admin, workspace, _ = _setup(client, ["ds-1"])
        outro = _headers_de(client, "pessoa@example.com")
        acessos = client.get(f"/workspaces/{workspace['id']}/access", headers=admin).json()
        padrao = next(a for a in acessos if a["is_default"])
        client.delete(f"/workspaces/{workspace['id']}/access/{padrao['group_id']}", headers=admin)

        resp = self._chama(client, outro, workspace, MagicMock())

        assert resp.status_code == 403

    def test_rota_por_relatorio_divide_o_cache_do_dataset_com_a_rota_em_lote(self, client):
        admin, workspace, (a, b) = _setup(client, ["ds-1", "ds-1"])
        info = MagicMock(return_value={"last_refresh": "x", "next_refresh": None})

        with patch.object(powerbi_core, "get_refresh_info", info):
            client.get(f"/workspaces/{workspace['id']}/powerbi/reports/{a['id']}/refresh-info", headers=admin)
            client.get(f"/workspaces/{workspace['id']}/powerbi/reports/{b['id']}/refresh-info", headers=admin)
            client.get(f"/workspaces/{workspace['id']}/powerbi/refresh-info", headers=admin)

        assert info.call_count == 1


def _warm(db_session, renew_minutes: int = 5) -> dict:
    """Roda um ciclo de aquecimento usando o banco de teste no lugar do banco real."""
    with patch("app.core.database.SessionLocal", return_value=db_session):
        return cache_warmup.warm_once(timedelta(minutes=renew_minutes))


def _pbi(generate, *, rls=False, info=None):
    """Os mocks do Power BI usados pelo aquecimento."""
    return (
        patch.object(powerbi_core, "get_report_details", return_value={"embedUrl": "https://embed/x"}),
        patch.object(powerbi_core, "dataset_requires_effective_identity", return_value=rls),
        patch.object(powerbi_core, "generate_embed_token", generate),
        patch.object(
            powerbi_core, "get_refresh_info", info or MagicMock(return_value={"last_refresh": "x", "next_refresh": None})
        ),
    )


class TestAquecimento:
    def test_enche_os_caches_e_a_primeira_pessoa_nao_espera_o_power_bi(self, client, db_session):
        admin, workspace, (report,) = _setup(client, ["ds-1"])
        generate = MagicMock(return_value=_token("aquecido"))
        p1, p2, p3, p4 = _pbi(generate)
        with p1, p2, p3, p4:
            stats = _warm(db_session)

        assert stats == {"relatorios": 1, "tokens_novos": 1, "datasets": 1, "erros": 0}
        # Depois do aquecimento, abrir o relatorio nao gera token nem chama o Power BI
        depois = MagicMock()
        resp = _embed(client, admin, workspace, report, generate=depois)
        assert resp.json()["access_token"] == "aquecido"
        assert depois.call_count == 0

    def test_renova_o_token_que_vence_logo_e_deixa_o_que_ainda_esta_longe(self, client, db_session):
        _, workspace, (report,) = _setup(client, ["ds-1"])
        generate = MagicMock(side_effect=[_token("v1"), _token("v2"), _token("v3")])
        p1, p2, p3, p4 = _pbi(generate)
        with p1, p2, p3, p4:
            _warm(db_session)
            # Token longe de vencer: o ciclo seguinte nao gera outro
            assert _warm(db_session)["tokens_novos"] == 0
            # Token perto de vencer: o ciclo renova antes de o cache ficar vazio
            chave = (workspace["id"], report["id"], None)
            _, config = embed_router._embed_cache[chave]
            embed_router._embed_cache[chave] = (datetime.now(timezone.utc) + timedelta(minutes=2), config)
            assert _warm(db_session)["tokens_novos"] == 1

        assert embed_router._embed_cache[chave][1].access_token == "v2"

    def test_relatorio_com_rls_nao_ganha_token_compartilhado(self, client, db_session):
        _setup(client, ["ds-1"])
        generate = MagicMock(return_value=_token())
        p1, p2, p3, p4 = _pbi(generate, rls=True)
        with p1, p2, p3, p4:
            stats = _warm(db_session)

        assert stats["tokens_novos"] == 0
        assert generate.call_count == 0
        assert not embed_router._embed_cache

    def test_aquece_tambem_a_info_de_atualizacao_uma_vez_por_dataset(self, client, db_session):
        _setup(client, ["ds-1", "ds-1", "ds-2"])
        info = MagicMock(return_value={"last_refresh": "x", "next_refresh": None})
        p1, p2, p3, p4 = _pbi(MagicMock(return_value=_token()), info=info)
        with p1, p2, p3, p4:
            stats = _warm(db_session)

        assert stats["datasets"] == 2
        assert info.call_count == 2

    def test_falha_em_um_relatorio_e_contada_e_nao_para_o_ciclo(self, client, db_session):
        _setup(client, ["ds-1", "ds-2"])
        generate = MagicMock(side_effect=[powerbi_core.PowerBIError("recusado"), _token()])
        p1, p2, p3, p4 = _pbi(generate)
        with p1, p2, p3, p4:
            stats = _warm(db_session)

        assert stats["relatorios"] == 2
        assert stats["tokens_novos"] == 1
        assert stats["erros"] == 1


class TestTarefaEmSegundoPlano:
    def setup_method(self):
        cache_warmup._thread = None
        cache_warmup._stop.clear()

    def teardown_method(self):
        cache_warmup.stop()
        if cache_warmup._thread is not None:
            cache_warmup._thread.join(timeout=3)
        cache_warmup._thread = None

    def test_nao_inicia_quando_esta_desligado(self):
        with patch.object(cache_warmup.settings, "cache_warmup_enabled", False):
            cache_warmup.start()

        assert cache_warmup._thread is None

    def test_inicia_roda_um_ciclo_e_para_quando_pedido(self):
        ciclo = MagicMock(return_value={"relatorios": 0, "tokens_novos": 0, "datasets": 0, "erros": 0})
        with patch.object(cache_warmup, "warm_once", ciclo), patch.object(
            cache_warmup.settings, "cache_warmup_enabled", True
        ):
            cache_warmup.start()
            espera = time.monotonic() + 3
            while ciclo.call_count == 0 and time.monotonic() < espera:
                time.sleep(0.02)
            thread = cache_warmup._thread
            cache_warmup.stop()
            thread.join(timeout=3)

        assert ciclo.call_count == 1
        assert not thread.is_alive()

    def test_um_ciclo_que_levanta_excecao_nao_derruba_a_tarefa(self):
        ciclo = MagicMock(side_effect=RuntimeError("falha"))
        with patch.object(cache_warmup, "warm_once", ciclo), patch.object(
            cache_warmup.settings, "cache_warmup_enabled", True
        ):
            cache_warmup.start()
            espera = time.monotonic() + 3
            while ciclo.call_count == 0 and time.monotonic() < espera:
                time.sleep(0.02)
            assert cache_warmup._thread.is_alive()
            cache_warmup.stop()

    def test_a_aplicacao_liga_e_desliga_a_tarefa_no_lifespan(self):
        from app.main import app

        with patch.object(cache_warmup, "start") as start, patch.object(cache_warmup, "stop") as stop:
            with TestClient(app):
                start.assert_called_once()
                stop.assert_not_called()
            stop.assert_called_once()


class TestAuditoriaDeAbertura:
    """Abrir um relatorio entra na auditoria (relatorios mais visitados), uma vez por janela."""

    @staticmethod
    def _aberturas(db_session, user_email=None):
        from app.models.audit_log import AuditLog

        query = db_session.query(AuditLog).filter(AuditLog.action == "view_report")
        if user_email:
            query = query.filter(AuditLog.user_email == user_email)
        return query.all()

    def test_abrir_o_relatorio_grava_uma_visita_com_o_nome_e_a_colecao(self, client, db_session):
        admin, workspace, (report,) = _setup(client, ["ds-1"])

        resp = _embed(client, admin, workspace, report, generate=MagicMock(return_value=_token()))

        assert resp.status_code == 200
        (visita,) = self._aberturas(db_session)
        assert visita.entity == "report"
        assert visita.entity_id == str(report["id"])
        assert visita.workspace_id == workspace["id"]
        assert visita.details == report["name"]
        assert visita.user_email == "admin@example.com"

    def test_reabrir_dentro_da_janela_nao_grava_outra_linha_mesmo_com_token_em_cache(self, client, db_session):
        admin, workspace, (report,) = _setup(client, ["ds-1"])
        generate = MagicMock(return_value=_token())

        for _ in range(3):
            assert _embed(client, admin, workspace, report, generate=generate).status_code == 200

        assert len(self._aberturas(db_session)) == 1
        assert generate.call_count == 1  # o terceiro veio do cache e a auditoria nao quebrou isso

    def test_cada_pessoa_conta_a_propria_visita(self, client, db_session):
        admin, workspace, (report,) = _setup(client, ["ds-1"])
        outro = _headers_de(client, "pessoa@example.com")
        generate = MagicMock(return_value=_token())

        _embed(client, admin, workspace, report, generate=generate)
        _embed(client, outro, workspace, report, generate=generate)

        assert {v.user_email for v in self._aberturas(db_session)} == {"admin@example.com", "pessoa@example.com"}

    def test_depois_da_janela_uma_nova_abertura_e_contada(self, client, db_session):
        from app.core.audit import VIEW_LOG_WINDOW

        admin, workspace, (report,) = _setup(client, ["ds-1"])
        generate = MagicMock(return_value=_token())
        _embed(client, admin, workspace, report, generate=generate)
        (visita,) = self._aberturas(db_session)
        visita.created_at = datetime.now(timezone.utc) - VIEW_LOG_WINDOW - timedelta(minutes=1)
        db_session.commit()

        _embed(client, admin, workspace, report, generate=generate)

        assert len(self._aberturas(db_session)) == 2

    def test_quem_nao_tem_acesso_nao_gera_visita(self, client, db_session):
        admin, workspace, (report,) = _setup(client, ["ds-1"])
        intruso = _headers_de(client, "intruso@example.com")
        # Tira o acesso do grupo padrao ("Todos os usuarios"): a pessoa deixa de ser membro
        acessos = client.get(f"/workspaces/{workspace['id']}/access", headers=admin).json()
        padrao = next(a for a in acessos if a["is_default"])
        client.delete(f"/workspaces/{workspace['id']}/access/{padrao['group_id']}", headers=admin)

        resp = _embed(client, intruso, workspace, report, generate=MagicMock(return_value=_token()))

        assert resp.status_code == 403
        assert self._aberturas(db_session, "intruso@example.com") == []

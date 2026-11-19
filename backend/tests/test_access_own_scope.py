"""Assinaturas e alertas tem dono: cada permissao simples vale so para o que a propria pessoa criou, e as permissoes
"de outras pessoas" valem para o que outras criaram. Tambem a atualizacao unica que da a "-outras" a quem ja tinha a simples."""

from unittest.mock import patch

import pytest

from app.core.access_catalog import CATALOG, OWN_TO_OTHERS, PRESETS, get, with_implied
from app.core.access_migration import OWN_SCOPE_STEP, migrate_own_scope_split
from app.models.access_grant import AccessGrant, AccessInviteGrant, AccessMigrationStep
from app.models.alert import ReportAlert
from app.models.subscription import ReportSubscription
from tests.test_subscriptions_api import _criar, _headers, _pbi, _url_rel, cenario  # noqa: F401  (cenario e fixture)

SUBS = ("assinatura.ver", "assinatura.criar", "assinatura.editar", "assinatura.excluir", "assinatura.executar")
ALERTAS = ("alerta.ver", "alerta.criar", "alerta.editar", "alerta.excluir")


def _id(client, admin, email):
    return next(u["id"] for u in client.get("/users/", headers=admin).json() if u["email"] == email)


def _dar(client, c, email, ws, chaves):
    """Da (ou troca) as permissoes avulsas de uma pessoa numa colecao."""
    uid = _id(client, c.admin, email)
    resposta = client.put(
        f"/access/users/{uid}", json={"blocks": [{"workspace_id": ws["id"], "permissions": list(chaves)}]}, headers=c.admin
    )
    assert resposta.status_code == 200, resposta.text


def _dar_blocos(client, c, email, por_colecao):
    """Troca todas as permissoes avulsas de uma pessoa: {colecao: [chaves]}."""
    blocos = [{"workspace_id": ws["id"], "permissions": list(chaves)} for ws, chaves in por_colecao]
    uid = _id(client, c.admin, email)
    assert client.put(f"/access/users/{uid}", json={"blocks": blocos}, headers=c.admin).status_code == 200


@pytest.fixture
def duas_pessoas(client, cenario):
    """`pessoa` e `colega`, as duas com ver a colecao A e todas as permissoes simples de assinaturas e alertas, sem nenhuma "-outras"."""
    c = cenario
    c.colega = _headers(client, "colega@empresa.com")
    base = ["colecao.ver", *SUBS, *ALERTAS]
    # Tira o papel de editor que o grupo padrao da na colecao A: so valem as avulsas abaixo
    from tests.access_helpers import grupo_padrao_id, tirar_acesso

    tirar_acesso(client, c.admin, c.ws_a["id"], grupo_padrao_id(client, c.admin))
    _dar(client, c, "pessoa@empresa.com", c.ws_a, base)
    _dar(client, c, "colega@empresa.com", c.ws_a, base)
    return c


def _url(c, sub):
    return f"/workspaces/{c.ws_a['id']}/subscriptions/{sub['id']}"


def _criar_alerta(db_session, c, dono_email, nome="Meta"):
    from app.models.user import User

    dono = db_session.query(User).filter(User.email == dono_email).first()
    alerta = ReportAlert(
        report_id=c.rel_a["id"], created_by_id=dono.id, created_by_name=dono.name, name=nome, measure_name="Total",
        condition=">", threshold=1.0, check_interval_minutes=60, cooldown_hours=24, enabled=True,
    )
    alerta.recipients = ["gestor@empresa.com"]
    db_session.add(alerta)
    db_session.commit()
    return alerta.id


class TestCatalogo:
    def test_cada_permissao_simples_tem_a_sua_de_outras_pessoas(self):
        for simples, outras in OWN_TO_OTHERS.items():
            assert get(simples) and get(outras), (simples, outras)
            assert simples in get(outras).requires, outras

    def test_editar_excluir_e_enviar_agora_de_outros_exigem_ver_os_de_outros(self):
        for chave in ("assinatura.editar-outras", "assinatura.excluir-outras", "assinatura.executar-outras", "alerta.editar-outras", "alerta.excluir-outras"):
            assert get(chave).requires[-1].endswith("ver-outras"), chave
        # ligar so "editar de outras" liga junto o que ela exige
        assert {"assinatura.ver", "assinatura.editar", "assinatura.ver-outras"} <= set(with_implied(["assinatura.editar-outras"]))

    def test_as_de_outras_pessoas_ficam_em_funcionalidades_separadas(self):
        for chave in OWN_TO_OTHERS.values():
            assert get(chave).feature in ("assinaturas-outras", "alertas-outras")

    def test_atalho_editor_nao_liga_as_de_outras_e_o_administrador_liga(self):
        assert not set(OWN_TO_OTHERS.values()) & set(PRESETS["editor"])
        assert set(OWN_TO_OTHERS.values()) <= set(PRESETS["administrador"])


class TestAssinaturas:
    def test_so_ve_as_proprias_sem_a_permissao_de_ver_as_de_outras(self, client, duas_pessoas):
        c = duas_pessoas
        minha = _criar(client, c, headers=c.pessoa).json()
        _criar(client, c, headers=c.colega)

        lista = client.get(f"/workspaces/{c.ws_a['id']}/subscriptions", headers=c.pessoa).json()
        assert [s["id"] for s in lista] == [minha["id"]]
        por_relatorio = client.get(_url_rel(c.ws_a, c.rel_a), headers=c.pessoa).json()
        assert [s["id"] for s in por_relatorio] == [minha["id"]]

    def test_com_ver_de_outras_ve_todas_e_a_tela_recebe_o_que_pode_fazer_em_cada_uma(self, client, duas_pessoas):
        c = duas_pessoas
        _dar(client, c, "pessoa@empresa.com", c.ws_a, ["colecao.ver", *SUBS, "assinatura.ver-outras"])
        minha = _criar(client, c, headers=c.pessoa).json()
        alheia = _criar(client, c, headers=c.colega).json()

        lista = {s["id"]: s for s in client.get(_url_rel(c.ws_a, c.rel_a), headers=c.pessoa).json()}
        assert set(lista) == {minha["id"], alheia["id"]}
        assert (lista[minha["id"]]["can_edit"], lista[minha["id"]]["can_delete"], lista[minha["id"]]["can_run"]) == (True, True, True)
        assert (lista[alheia["id"]]["can_edit"], lista[alheia["id"]]["can_delete"], lista[alheia["id"]]["can_run"]) == (False, False, False)
        assert lista[alheia["id"]]["created_by_id"] == _id(client, c.admin, "colega@empresa.com")

    def test_nao_ve_nem_mexe_na_de_outra_pessoa_sem_a_permissao(self, client, duas_pessoas):
        c = duas_pessoas
        alheia = _criar(client, c, headers=c.colega).json()
        base = _url(c, alheia)

        assert client.get(base, headers=c.pessoa).status_code == 403
        assert client.get(base + "/runs", headers=c.pessoa).status_code == 403
        assert client.put(base, json={"enabled": False}, headers=c.pessoa).status_code == 403
        assert client.delete(base, headers=c.pessoa).status_code == 403
        assert client.post(base + "/run", headers=c.pessoa).status_code == 403

    def test_mexe_na_propria_com_as_permissoes_simples(self, client, duas_pessoas):
        c = duas_pessoas
        minha = _criar(client, c, headers=c.pessoa).json()
        base = _url(c, minha)

        assert client.get(base, headers=c.pessoa).status_code == 200
        assert client.put(base, json={"enabled": False}, headers=c.pessoa).status_code == 200
        assert client.delete(base, headers=c.pessoa).status_code == 204

    @pytest.mark.parametrize(
        "extra,metodo,sufixo,corpo,esperado",
        [
            ("assinatura.ver-outras", "get", "", None, 200),
            ("assinatura.editar-outras", "put", "", {"enabled": False}, 200),
            ("assinatura.excluir-outras", "delete", "", None, 204),
        ],
    )
    def test_cada_permissao_de_outras_libera_so_a_sua_acao(self, client, duas_pessoas, extra, metodo, sufixo, corpo, esperado):
        c = duas_pessoas
        _dar(client, c, "pessoa@empresa.com", c.ws_a, ["colecao.ver", *SUBS, *with_implied([extra])])
        alheia = _criar(client, c, headers=c.colega).json()
        base = _url(c, alheia) + sufixo
        kwargs = {"headers": c.pessoa, **({"json": corpo} if corpo is not None else {})}

        assert client.request(metodo.upper(), base, **kwargs).status_code == esperado
        # e as outras acoes continuam fechadas
        fechadas = {"assinatura.editar-outras": ("delete",), "assinatura.excluir-outras": ("put",), "assinatura.ver-outras": ("put", "delete")}[extra]
        for outro in fechadas:
            outra = _criar(client, c, headers=c.colega).json()
            resposta = client.request(outro.upper(), _url(c, outra), headers=c.pessoa, **({"json": {"enabled": False}} if outro == "put" else {}))
            assert resposta.status_code == 403, (extra, outro)

    def test_enviar_agora_de_outras_pessoas(self, client, duas_pessoas):
        c = duas_pessoas
        alheia = _criar(client, c, headers=c.colega).json()
        assert client.post(_url(c, alheia) + "/run", headers=c.pessoa).status_code == 403

        _dar(client, c, "pessoa@empresa.com", c.ws_a, ["colecao.ver", *SUBS, *with_implied(["assinatura.executar-outras"])])
        with patch("app.routers.subscriptions.subscription_runner.start_run_thread"):
            assert client.post(_url(c, alheia) + "/run", headers=c.pessoa).status_code == 202

    def test_assinatura_sem_dono_conta_como_de_outra_pessoa(self, client, duas_pessoas, db_session):
        c = duas_pessoas
        sub = _criar(client, c, headers=c.colega).json()
        db_session.query(ReportSubscription).filter(ReportSubscription.id == sub["id"]).update({"created_by_id": None})
        db_session.commit()

        assert client.get(_url(c, sub), headers=c.pessoa).status_code == 403
        _dar(client, c, "pessoa@empresa.com", c.ws_a, ["colecao.ver", *SUBS, "assinatura.ver-outras"])
        assert client.get(_url(c, sub), headers=c.pessoa).status_code == 200

    def test_administrador_da_plataforma_ve_e_mexe_em_tudo(self, client, duas_pessoas):
        c = duas_pessoas
        alheia = _criar(client, c, headers=c.colega).json()
        assert client.get(_url(c, alheia), headers=c.admin).status_code == 200
        assert client.put(_url(c, alheia), json={"enabled": False}, headers=c.admin).status_code == 200
        assert client.delete(_url(c, alheia), headers=c.admin).status_code == 204

    def test_permissao_de_outras_vale_so_na_colecao_em_que_foi_dada(self, client, duas_pessoas):
        c = duas_pessoas
        _dar_blocos(
            client, c, "pessoa@empresa.com",
            [(c.ws_a, ["colecao.ver", *SUBS, "assinatura.ver-outras"]), (c.ws_b, ["colecao.ver", "assinatura.ver"])],
        )
        de_outra_na_a = _criar(client, c).json()  # criada pelo administrador
        de_outra_na_b = _criar(client, c, ws=c.ws_b, rel=c.rel_b).json()

        na_a = client.get(f"/workspaces/{c.ws_a['id']}/subscriptions", headers=c.pessoa).json()
        na_b = client.get(f"/workspaces/{c.ws_b['id']}/subscriptions", headers=c.pessoa).json()
        assert [x["id"] for x in na_a] == [de_outra_na_a["id"]]
        assert na_b == []  # na B ela so ve as proprias, e a unica existente e do administrador
        assert client.get(f"/workspaces/{c.ws_b['id']}/subscriptions/{de_outra_na_b['id']}", headers=c.pessoa).status_code == 403


class TestAlertas:
    def test_so_ve_os_proprios_sem_a_permissao_de_ver_os_de_outras(self, client, duas_pessoas, db_session):
        c = duas_pessoas
        meu = _criar_alerta(db_session, c, "pessoa@empresa.com", "meu")
        _criar_alerta(db_session, c, "colega@empresa.com", "dele")

        lista = client.get(f"/workspaces/{c.ws_a['id']}/reports/{c.rel_a['id']}/alerts", headers=c.pessoa).json()
        assert [a["id"] for a in lista] == [meu]
        assert lista[0]["can_edit"] is True and lista[0]["can_delete"] is True

    def test_nao_edita_nem_exclui_o_de_outra_pessoa(self, client, duas_pessoas, db_session):
        c = duas_pessoas
        alheio = _criar_alerta(db_session, c, "colega@empresa.com")
        base = f"/workspaces/{c.ws_a['id']}/alerts/{alheio}"

        assert client.put(base, json={"enabled": False}, headers=c.pessoa).status_code == 403
        assert client.delete(base, headers=c.pessoa).status_code == 403

    def test_com_as_permissoes_de_outras_ve_edita_e_exclui(self, client, duas_pessoas, db_session):
        c = duas_pessoas
        _dar(client, c, "pessoa@empresa.com", c.ws_a, ["colecao.ver", *ALERTAS, *with_implied(["alerta.editar-outras", "alerta.excluir-outras"])])
        alheio = _criar_alerta(db_session, c, "colega@empresa.com")
        base = f"/workspaces/{c.ws_a['id']}/alerts/{alheio}"

        lista = client.get(f"/workspaces/{c.ws_a['id']}/reports/{c.rel_a['id']}/alerts", headers=c.pessoa).json()
        assert [a["id"] for a in lista] == [alheio]
        assert (lista[0]["can_edit"], lista[0]["can_delete"]) == (True, True)
        assert client.put(base, json={"enabled": False}, headers=c.pessoa).status_code == 200
        assert client.delete(base, headers=c.pessoa).status_code == 204

    def test_editar_de_outras_sem_excluir_de_outras(self, client, duas_pessoas, db_session):
        c = duas_pessoas
        _dar(client, c, "pessoa@empresa.com", c.ws_a, ["colecao.ver", *ALERTAS, *with_implied(["alerta.editar-outras"])])
        alheio = _criar_alerta(db_session, c, "colega@empresa.com")
        base = f"/workspaces/{c.ws_a['id']}/alerts/{alheio}"

        assert client.put(base, json={"enabled": False}, headers=c.pessoa).status_code == 200
        assert client.delete(base, headers=c.pessoa).status_code == 403


class TestAtualizacaoUnica:
    def _grants(self, db_session):
        return {(g.group_id, g.user_id, g.workspace_id, g.permission_key) for g in db_session.query(AccessGrant).all()}

    def test_quem_ja_tinha_a_permissao_simples_ganha_a_de_outras_e_o_resto_fica_igual(self, db_session):
        from app.models.user import User
        from app.models.workspace import Group, Workspace

        grupo = Group(name="G")
        pessoa = User(name="P", email="p@x.com", hashed_password="x")
        ws = Workspace(name="W", slug="w")
        db_session.add_all([grupo, pessoa, ws])
        db_session.commit()
        db_session.add_all(
            [
                AccessGrant(group_id=grupo.id, workspace_id=ws.id, permission_key=k)
                for k in ("colecao.ver", "assinatura.ver", "assinatura.editar", "alerta.ver", "alerta.excluir")
            ]
            + [AccessGrant(user_id=pessoa.id, workspace_id=ws.id, permission_key=k) for k in ("colecao.ver", "assinatura.ver", "assinatura.executar")]
            + [AccessInviteGrant(email="novo@x.com", workspace_id=ws.id, permission_key="assinatura.ver")]
        )
        db_session.commit()

        criadas = migrate_own_scope_split(db_session)

        grants = self._grants(db_session)
        for chave in ("assinatura.ver-outras", "assinatura.editar-outras", "alerta.ver-outras", "alerta.excluir-outras"):
            assert (grupo.id, None, ws.id, chave) in grants, chave
        assert (grupo.id, None, ws.id, "assinatura.excluir-outras") not in grants  # nao tinha excluir
        assert (None, pessoa.id, ws.id, "assinatura.ver-outras") in grants
        assert (None, pessoa.id, ws.id, "assinatura.executar-outras") in grants
        assert db_session.query(AccessInviteGrant).filter_by(email="novo@x.com", permission_key="assinatura.ver-outras").count() == 1
        assert criadas == 7  # grupo: 4, pessoa: 2 (ver e enviar agora), convite: 1
        assert db_session.get(AccessMigrationStep, OWN_SCOPE_STEP) is not None

    def test_roda_uma_vez_so_e_nao_devolve_o_que_o_administrador_tirou_depois(self, db_session):
        from app.models.workspace import Group, Workspace

        grupo, ws = Group(name="G"), Workspace(name="W", slug="w")
        db_session.add_all([grupo, ws])
        db_session.commit()
        db_session.add(AccessGrant(group_id=grupo.id, workspace_id=ws.id, permission_key="assinatura.ver"))
        db_session.commit()
        migrate_own_scope_split(db_session)

        db_session.query(AccessGrant).filter_by(permission_key="assinatura.ver-outras").delete()
        db_session.commit()
        assert migrate_own_scope_split(db_session) == 0
        assert db_session.query(AccessGrant).filter_by(permission_key="assinatura.ver-outras").count() == 0

    def test_nao_duplica_quando_a_de_outras_ja_existe(self, db_session):
        from app.models.workspace import Group, Workspace

        grupo, ws = Group(name="G"), Workspace(name="W", slug="w")
        db_session.add_all([grupo, ws])
        db_session.commit()
        db_session.add_all(
            [
                AccessGrant(group_id=grupo.id, workspace_id=ws.id, permission_key="assinatura.ver"),
                AccessGrant(group_id=grupo.id, workspace_id=ws.id, permission_key="assinatura.ver-outras"),
            ]
        )
        db_session.commit()

        assert migrate_own_scope_split(db_session) == 0
        assert db_session.query(AccessGrant).filter_by(permission_key="assinatura.ver-outras").count() == 1

    def test_banco_novo_sem_nada_so_marca(self, db_session):
        assert migrate_own_scope_split(db_session) == 0
        assert db_session.get(AccessMigrationStep, OWN_SCOPE_STEP) is not None

    def test_o_catalogo_nao_tem_chave_repetida(self):
        chaves = [p.key for p in CATALOG]
        assert len(chaves) == len(set(chaves))

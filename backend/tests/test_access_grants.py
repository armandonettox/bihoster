"""Permissoes unificadas (etapa 1): catalogo, calculo da permissao efetiva, copia dos dados antigos e API."""

import pytest

from app.core.access_catalog import CATALOG, GLOBAL, NOT_IN_PRESETS, PRESETS, WORKSPACE, WORKSPACE_KEYS, scope_of, with_implied
from app.core.access_engine import effective_access
from app.core.access_migration import migrate_legacy_access
from app.models.access_grant import AccessGrant, AccessMigrationMark
from app.models.group_permission import GroupPermission
from app.models.user import UserRole
from app.models.workspace import Group, GroupMember, GroupWorkspaceAccess

PASSWORD = "SenhaForte123"


def _headers(client, email: str) -> dict:
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestCatalogo:
    def test_escopo_de_cada_chave(self):
        assert scope_of("relatorio.publicar") == WORKSPACE
        assert scope_of("ia.usar") == GLOBAL
        assert scope_of("nao.existe") is None

    def test_qualquer_permissao_de_colecao_implica_ver(self):
        assert with_implied(["relatorio.excluir"]) == ["colecao.ver", "relatorio.excluir"]

    def test_lista_vazia_continua_vazia(self):
        assert with_implied([]) == []

    def test_criar_analiticos_implica_ver(self):
        assert "analiticos.ver" in with_implied(["analiticos.criar"])

    def test_exigencia_vale_em_cadeia(self):
        # Enviar para qualquer domínio exige criar assinatura, que exige ver as assinaturas, que exige ver a coleção
        assert with_implied(["assinatura.qualquer-dominio"]) == [
            "colecao.ver",
            "assinatura.ver",
            "assinatura.criar",
            "assinatura.qualquer-dominio",
        ]

    def test_ordem_e_a_do_catalogo_sem_repetidos(self):
        assert with_implied(["alerta.excluir", "alerta.ver", "alerta.excluir"]) == ["colecao.ver", "alerta.ver", "alerta.excluir"]

    def test_atalho_administrador_tem_todas_as_de_colecao_menos_as_que_so_valem_ligadas_de_proposito(self):
        assert set(PRESETS["administrador"]) == set(WORKSPACE_KEYS) - NOT_IN_PRESETS
        assert NOT_IN_PRESETS == {"relatorio.exportar"}  # exportar por e-mail era só do administrador da plataforma

    def test_atalho_leitor_so_ve(self):
        assert PRESETS["leitor"] == ("colecao.ver",)

    def test_atalho_editor_nao_da_o_que_era_so_do_administrador(self):
        assert not {"colecao.editar", "colecao.excluir", "colecao.auditoria", "assinatura.qualquer-dominio"} & set(PRESETS["editor"])

    def test_gerenciar_a_ia_virou_cinco_itens_separados(self):
        itens = [p.key for p in CATALOG if p.feature == "ia-gerenciar"]
        assert itens == ["ia.chaves", "ia.modelos", "ia.bloqueios", "ia.registro", "ia.consumo"]
        assert all(p.scope == GLOBAL for p in CATALOG if p.feature == "ia-gerenciar")
        assert "ia.gerenciar" not in {p.key for p in CATALOG}

    def test_todo_grupo_de_itens_tem_mais_de_um_item_e_um_so_escopo(self):
        por_grupo: dict[str, list] = {}
        for p in CATALOG:
            if p.feature:
                por_grupo.setdefault(p.feature, []).append(p)
        assert por_grupo
        for nome, itens in por_grupo.items():
            assert len(itens) > 1, nome
            assert len({p.scope for p in itens}) == 1, nome
            assert len({p.section for p in itens}) == 1, nome
            assert len({p.feature_label for p in itens}) == 1, nome

    def test_toda_exigencia_aponta_para_uma_permissao_do_mesmo_escopo(self):
        chaves = {p.key: p for p in CATALOG}
        for p in CATALOG:
            for exigida in p.requires:
                assert exigida in chaves, (p.key, exigida)
                assert chaves[exigida].scope == p.scope, (p.key, exigida)
                assert exigida != p.key

    def test_chaves_do_catalogo_nao_se_repetem(self):
        chaves = [p.key for p in CATALOG]
        assert len(chaves) == len(set(chaves))


class TestMotor:
    def _grupo_com(self, db, user, ws_id, keys, name="G"):
        group = Group(name=name)
        db.add(group)
        db.commit()
        db.add(GroupMember(group_id=group.id, user_id=user.id))
        for key in keys:
            db.add(AccessGrant(group_id=group.id, workspace_id=ws_id, permission_key=key))
        db.commit()
        return group

    def test_pessoa_sem_nada_nao_tem_nada(self, db_session, make_user):
        pessoa = make_user("a@x.com")
        acesso = effective_access(db_session, pessoa.id)
        assert not acesso.is_admin and not acesso.global_keys and not acesso.by_workspace

    def test_soma_de_dois_grupos(self, db_session, make_user, make_workspace):
        pessoa, ws = make_user("a@x.com"), make_workspace("Vendas")
        self._grupo_com(db_session, pessoa, ws.id, ["relatorio.publicar"], "G1")
        self._grupo_com(db_session, pessoa, ws.id, ["relatorio.excluir"], "G2")
        acesso = effective_access(db_session, pessoa.id)
        assert acesso.has_in_workspace("relatorio.publicar", ws.id)
        assert acesso.has_in_workspace("relatorio.excluir", ws.id)
        assert acesso.has_in_workspace("colecao.ver", ws.id)

    def test_permissao_de_uma_colecao_nao_vale_em_outra(self, db_session, make_user, make_workspace):
        pessoa = make_user("a@x.com")
        vendas, financeiro = make_workspace("Vendas"), make_workspace("Financeiro")
        self._grupo_com(db_session, pessoa, vendas.id, ["relatorio.excluir"])
        acesso = effective_access(db_session, pessoa.id)
        assert acesso.has_in_workspace("relatorio.excluir", vendas.id)
        assert not acesso.has_in_workspace("relatorio.excluir", financeiro.id)

    def test_permissao_avulsa_soma_com_a_do_grupo(self, db_session, make_user, make_workspace):
        pessoa, ws = make_user("a@x.com"), make_workspace("Vendas")
        self._grupo_com(db_session, pessoa, ws.id, ["relatorio.publicar"])
        db_session.add(AccessGrant(user_id=pessoa.id, workspace_id=ws.id, permission_key="relatorio.excluir"))
        db_session.add(AccessGrant(user_id=pessoa.id, workspace_id=None, permission_key="ia.usar"))
        db_session.commit()
        acesso = effective_access(db_session, pessoa.id)
        assert acesso.has_in_workspace("relatorio.publicar", ws.id)
        assert acesso.has_in_workspace("relatorio.excluir", ws.id)
        assert acesso.has_global("ia.usar")

    def test_linha_com_escopo_trocado_e_ignorada(self, db_session, make_user, make_workspace):
        pessoa, ws = make_user("a@x.com"), make_workspace("Vendas")
        db_session.add(AccessGrant(user_id=pessoa.id, workspace_id=None, permission_key="relatorio.excluir"))
        db_session.add(AccessGrant(user_id=pessoa.id, workspace_id=ws.id, permission_key="ia.usar"))
        db_session.commit()
        acesso = effective_access(db_session, pessoa.id)
        assert not acesso.global_keys and not acesso.by_workspace

    def test_administrador_tem_tudo_em_toda_colecao(self, db_session, make_user, make_workspace):
        pessoa, ws = make_user("a@x.com"), make_workspace("Vendas")
        admin_group = Group(name="Administradores", is_admin_group=True)
        db_session.add(admin_group)
        db_session.commit()
        db_session.add(GroupMember(group_id=admin_group.id, user_id=pessoa.id))
        db_session.commit()
        acesso = effective_access(db_session, pessoa.id)
        assert acesso.is_admin
        assert acesso.has_in_workspace("colecao.excluir", ws.id)
        assert acesso.has_global("ia.chaves")


class TestMigracao:
    def test_papeis_viram_permissoes_e_chaves_de_grupo_viram_globais(self, db_session, make_workspace):
        ws = make_workspace("Vendas")
        leitor, editor, admin, ia = (Group(name=n) for n in ("Leitores", "Editores", "Admins da colecao", "IA"))
        db_session.add_all([leitor, editor, admin, ia])
        db_session.commit()
        db_session.add_all(
            [
                GroupWorkspaceAccess(group_id=leitor.id, workspace_id=ws.id, role=UserRole.viewer),
                GroupWorkspaceAccess(group_id=editor.id, workspace_id=ws.id, role=UserRole.editor),
                GroupWorkspaceAccess(group_id=admin.id, workspace_id=ws.id, role=UserRole.admin),
                GroupPermission(group_id=ia.id, permission_key="ia.usar"),
                GroupPermission(group_id=ia.id, permission_key="chave.antiga"),
            ]
        )
        db_session.commit()

        migrate_legacy_access(db_session)

        def chaves(group_id, ws_id):
            rows = db_session.query(AccessGrant).filter_by(group_id=group_id, workspace_id=ws_id).all()
            return {r.permission_key for r in rows}

        assert chaves(leitor.id, ws.id) == {"colecao.ver"}
        assert chaves(editor.id, ws.id) == set(PRESETS["editor"])
        assert chaves(admin.id, ws.id) == set(WORKSPACE_KEYS) - NOT_IN_PRESETS
        assert chaves(ia.id, None) == {"ia.usar"}

    def test_gerenciar_a_ia_antigo_vira_os_cinco_itens_sem_repetir(self, db_session):
        grupo = Group(name="Dados")
        db_session.add(grupo)
        db_session.commit()
        db_session.add_all(
            [
                GroupPermission(group_id=grupo.id, permission_key="ia.gerenciar"),
                GroupPermission(group_id=grupo.id, permission_key="ia.usar"),
                GroupPermission(group_id=grupo.id, permission_key="analiticos.criar"),
                GroupPermission(group_id=grupo.id, permission_key="analiticos.ver"),
            ]
        )
        db_session.commit()

        migrate_legacy_access(db_session)

        linhas = db_session.query(AccessGrant).filter_by(group_id=grupo.id).all()
        assert sorted(r.permission_key for r in linhas) == sorted(
            ["ia.usar", "ia.chaves", "ia.modelos", "ia.bloqueios", "ia.registro", "ia.consumo", "analiticos.ver", "analiticos.criar"]
        )
        assert all(r.workspace_id is None for r in linhas)

    def test_roda_uma_vez_so(self, db_session, make_workspace):
        ws = make_workspace("Vendas")
        group = Group(name="G")
        db_session.add(group)
        db_session.commit()
        db_session.add(GroupWorkspaceAccess(group_id=group.id, workspace_id=ws.id, role=UserRole.viewer))
        db_session.commit()

        assert migrate_legacy_access(db_session) == 1
        # O admin tira a permissao na tela nova; reiniciar o servidor nao pode devolver
        db_session.query(AccessGrant).delete()
        db_session.commit()
        assert migrate_legacy_access(db_session) == 0
        assert db_session.query(AccessGrant).count() == 0
        assert db_session.query(AccessMigrationMark).count() == 1


@pytest.fixture
def admin(client):
    return _headers(client, "admin@example.com")


@pytest.fixture
def pessoa(client, admin):
    return _headers(client, "pessoa@example.com")


@pytest.fixture
def colecao(client, admin):
    return client.post("/workspaces/", json={"name": "Vendas"}, headers=admin).json()["id"]


def _grupo(client, admin, nome="Comercial") -> int:
    return client.post("/groups/", json={"name": nome}, headers=admin).json()["id"]


class TestApi:
    def test_catalogo_so_para_admin(self, client, admin, pessoa):
        assert client.get("/access/catalog", headers=pessoa).status_code == 403
        corpo = client.get("/access/catalog", headers=admin).json()
        assert {p["key"] for p in corpo["permissions"]} >= {"colecao.ver", "ia.usar"}
        assert set(corpo["presets"]) == {"leitor", "editor", "administrador"}

    def test_catalogo_traz_grupos_de_itens_e_exigencias(self, client, admin):
        corpo = client.get("/access/catalog", headers=admin).json()
        por_chave = {p["key"]: p for p in corpo["permissions"]}
        assert por_chave["ia.chaves"]["feature"] == "ia-gerenciar"
        assert por_chave["ia.chaves"]["feature_label"] == "Gerenciar a IA"
        assert por_chave["assinatura.criar"]["requires"] == ["colecao.ver", "assinatura.ver"]
        assert por_chave["ia.usar"]["feature"] is None
        assert por_chave["colecao.ver"]["requires"] == []

    def test_cada_item_do_grupo_grava_sozinho_e_traz_so_o_que_exige(self, client, admin, colecao):
        grupo = _grupo(client, admin)
        resp = client.put(
            f"/access/groups/{grupo}",
            json={"blocks": [{"workspace_id": None, "permissions": ["ia.chaves"]}, {"workspace_id": colecao, "permissions": ["assinatura.criar"]}]},
            headers=admin,
        )
        assert resp.status_code == 200
        blocos = {b["workspace_id"]: b["permissions"] for b in resp.json()["blocks"]}
        assert blocos[None] == ["ia.chaves"]  # os outros quatro itens da IA continuam desligados
        assert blocos[colecao] == ["colecao.ver", "assinatura.ver", "assinatura.criar"]

    def test_permissao_antiga_agrupada_e_recusada(self, client, admin):
        grupo = _grupo(client, admin)
        for chave in ("ia.gerenciar", "assinatura.gerenciar", "alerta.gerenciar"):
            resp = client.put(f"/access/groups/{grupo}", json={"blocks": [{"workspace_id": None, "permissions": [chave]}]}, headers=admin)
            assert resp.status_code == 422, chave

    def test_exige_login(self, client):
        assert client.get("/access/me").status_code == 401
        assert client.get("/access/groups/1").status_code == 401

    def test_grava_e_le_permissoes_do_grupo_por_escopo(self, client, admin, colecao):
        grupo = _grupo(client, admin)
        corpo = {
            "blocks": [
                {"workspace_id": None, "permissions": ["ia.usar"]},
                {"workspace_id": colecao, "permissions": ["relatorio.excluir"]},
            ]
        }
        resp = client.put(f"/access/groups/{grupo}", json=corpo, headers=admin)
        assert resp.status_code == 200
        blocos = {b["workspace_id"]: b["permissions"] for b in resp.json()["blocks"]}
        assert blocos[None] == ["ia.usar"]
        assert blocos[colecao] == ["colecao.ver", "relatorio.excluir"]  # ver vem junto
        assert client.get(f"/access/groups/{grupo}", headers=admin).json() == resp.json()

    def test_gravar_de_novo_substitui_tudo(self, client, admin, colecao):
        grupo = _grupo(client, admin)
        client.put(f"/access/groups/{grupo}", json={"blocks": [{"workspace_id": None, "permissions": ["ia.usar"]}]}, headers=admin)
        resp = client.put(f"/access/groups/{grupo}", json={"blocks": []}, headers=admin)
        assert resp.json()["blocks"] == []

    def test_chave_no_escopo_errado_e_recusada(self, client, admin, colecao):
        grupo = _grupo(client, admin)
        resp = client.put(
            f"/access/groups/{grupo}",
            json={"blocks": [{"workspace_id": None, "permissions": ["relatorio.excluir"]}]},
            headers=admin,
        )
        assert resp.status_code == 422
        resp = client.put(
            f"/access/groups/{grupo}",
            json={"blocks": [{"workspace_id": colecao, "permissions": ["ia.usar"]}]},
            headers=admin,
        )
        assert resp.status_code == 422

    def test_chave_desconhecida_e_escopo_repetido_sao_recusados(self, client, admin, colecao):
        grupo = _grupo(client, admin)
        assert client.put(f"/access/groups/{grupo}", json={"blocks": [{"workspace_id": None, "permissions": ["x.y"]}]}, headers=admin).status_code == 422
        repetido = {"blocks": [{"workspace_id": None, "permissions": ["ia.usar"]}, {"workspace_id": None, "permissions": ["ia.gerenciar"]}]}
        assert client.put(f"/access/groups/{grupo}", json=repetido, headers=admin).status_code == 422

    def test_colecao_inexistente_da_404(self, client, admin):
        grupo = _grupo(client, admin)
        resp = client.put(f"/access/groups/{grupo}", json={"blocks": [{"workspace_id": 999, "permissions": ["relatorio.editar"]}]}, headers=admin)
        assert resp.status_code == 404

    def test_grupo_administradores_nao_e_editavel(self, client, admin):
        grupos = client.get("/groups/", headers=admin).json()
        admin_id = next(g["id"] for g in grupos if g["is_admin_group"])
        assert client.get(f"/access/groups/{admin_id}", headers=admin).json()["editable"] is False
        assert client.put(f"/access/groups/{admin_id}", json={"blocks": []}, headers=admin).status_code == 400

    def test_so_admin_grava(self, client, admin, pessoa):
        grupo = _grupo(client, admin)
        assert client.put(f"/access/groups/{grupo}", json={"blocks": []}, headers=pessoa).status_code == 403
        assert client.get(f"/access/groups/{grupo}", headers=pessoa).status_code == 403

    def test_permissao_avulsa_aparece_em_access_me(self, client, admin, pessoa, colecao):
        usuarios = client.get("/users/", headers=admin).json()
        pessoa_id = next(u["id"] for u in usuarios if u["email"] == "pessoa@example.com")
        corpo = {"blocks": [{"workspace_id": colecao, "permissions": ["relatorio.publicar"]}, {"workspace_id": None, "permissions": ["ia.usar"]}]}
        assert client.put(f"/access/users/{pessoa_id}", json=corpo, headers=admin).status_code == 200
        meu = client.get("/access/me", headers=pessoa).json()
        assert meu["is_admin"] is False
        assert meu["global_permissions"] == ["ia.usar"]
        assert meu["workspace_permissions"][str(colecao)] == ["colecao.ver", "relatorio.publicar"]

    def test_permissao_do_grupo_chega_na_pessoa(self, client, admin, pessoa, colecao):
        grupo = _grupo(client, admin)
        client.post(f"/groups/{grupo}/members", json={"email": "pessoa@example.com"}, headers=admin)
        client.put(f"/access/groups/{grupo}", json={"blocks": [{"workspace_id": colecao, "permissions": ["relatorio.editar"]}]}, headers=admin)
        meu = client.get("/access/me", headers=pessoa).json()
        assert "relatorio.editar" in meu["workspace_permissions"][str(colecao)]

    def test_admin_ve_tudo_em_access_me(self, client, admin, colecao):
        meu = client.get("/access/me", headers=admin).json()
        assert meu["is_admin"] is True
        assert "colecao.excluir" in meu["workspace_permissions"][str(colecao)]

    def test_nao_da_para_editar_permissao_avulsa_de_administrador(self, client, admin):
        usuarios = client.get("/users/", headers=admin).json()
        admin_id = next(u["id"] for u in usuarios if u["email"] == "admin@example.com")
        assert client.put(f"/access/users/{admin_id}", json={"blocks": []}, headers=admin).status_code == 400

    def test_apagar_grupo_nao_deixa_permissao_orfa(self, client, admin, db_session):
        # Garante que a rota de excluir grupo continua funcionando com a tabela nova existindo
        grupo = _grupo(client, admin)
        client.put(f"/access/groups/{grupo}", json={"blocks": [{"workspace_id": None, "permissions": ["ia.usar"]}]}, headers=admin)
        assert client.delete(f"/groups/{grupo}", headers=admin).status_code in (200, 204)


class TestLimpezaAoExcluir:
    def test_excluir_grupo_colecao_e_pessoa_apaga_as_permissoes_deles(self, client, admin, pessoa, colecao, db_session):
        grupo = _grupo(client, admin)
        client.put(f"/access/groups/{grupo}", json={"blocks": [{"workspace_id": colecao, "permissions": ["relatorio.editar"]}]}, headers=admin)
        usuarios = client.get("/users/", headers=admin).json()
        pessoa_id = next(u["id"] for u in usuarios if u["email"] == "pessoa@example.com")
        client.put(f"/access/users/{pessoa_id}", json={"blocks": [{"workspace_id": colecao, "permissions": ["relatorio.publicar"]}]}, headers=admin)
        # Fora o acesso de leitura do grupo padrao, que toda coleção nova ganha
        do_teste = AccessGrant.group_id.is_(None) | (AccessGrant.group_id == grupo)
        assert db_session.query(AccessGrant).filter(do_teste).count() == 4

        client.delete(f"/groups/{grupo}", headers=admin)
        assert db_session.query(AccessGrant).filter(AccessGrant.group_id == grupo).count() == 0

        client.delete(f"/workspaces/{colecao}", headers=admin)
        assert db_session.query(AccessGrant).count() == 0

    def test_excluir_pessoa_apaga_as_permissoes_avulsas(self, client, admin, pessoa, db_session):
        usuarios = client.get("/users/", headers=admin).json()
        pessoa_id = next(u["id"] for u in usuarios if u["email"] == "pessoa@example.com")
        client.put(f"/access/users/{pessoa_id}", json={"blocks": [{"workspace_id": None, "permissions": ["ia.usar"]}]}, headers=admin)
        assert db_session.query(AccessGrant).count() == 1
        client.delete(f"/users/{pessoa_id}", headers=admin)
        assert db_session.query(AccessGrant).count() == 0


class TestRelatorio:
    @pytest.fixture
    def cenario(self, client, admin, colecao):
        """Maria no grupo Comercial (publicar em Vendas) e com 'excluir' avulso em Vendas; Joao sem nada."""
        financeiro = client.post("/workspaces/", json={"name": "Financeiro"}, headers=admin).json()["id"]
        _headers(client, "maria@example.com")
        _headers(client, "joao@example.com")
        grupo = _grupo(client, admin, "Comercial")
        client.post(f"/groups/{grupo}/members", json={"email": "maria@example.com"}, headers=admin)
        client.put(
            f"/access/groups/{grupo}",
            json={"blocks": [{"workspace_id": colecao, "permissions": ["relatorio.publicar"]}, {"workspace_id": None, "permissions": ["ia.usar"]}]},
            headers=admin,
        )
        usuarios = client.get("/users/", headers=admin).json()
        maria = next(u["id"] for u in usuarios if u["email"] == "maria@example.com")
        client.put(f"/access/users/{maria}", json={"blocks": [{"workspace_id": colecao, "permissions": ["relatorio.excluir"]}]}, headers=admin)
        return {"grupo": grupo, "vendas": colecao, "financeiro": financeiro, "maria": maria}

    def _rows(self, client, admin, **params):
        resp = client.get("/access/report", params=params, headers=admin)
        assert resp.status_code == 200
        return resp.json()["rows"]

    def test_so_admin_consulta(self, client, admin, cenario):
        pessoa = _headers(client, "outra@example.com")
        assert client.get("/access/report", headers=pessoa).status_code == 403
        assert client.get("/access/report").status_code == 401

    def test_mostra_a_origem_de_cada_permissao(self, client, admin, cenario):
        rows = self._rows(client, admin, search="maria")
        vendas = next(r for r in rows if r["workspace_id"] == cenario["vendas"])
        por_chave = {p["key"]: p for p in vendas["permissions"]}
        assert por_chave["relatorio.publicar"]["groups"] == ["Comercial"] and por_chave["relatorio.publicar"]["direct"] is False
        assert por_chave["relatorio.excluir"]["groups"] == [] and por_chave["relatorio.excluir"]["direct"] is True
        assert "colecao.ver" in por_chave  # implícita
        globais = next(r for r in rows if r["workspace_id"] is None)
        assert [p["key"] for p in globais["permissions"]] == ["ia.usar"]
        assert "Comercial" in [g["name"] for g in vendas["groups"]]
        assert {g["name"]: g["is_default"] for g in vendas["groups"]}["Comercial"] is False
        assert any(g["is_default"] for g in vendas["groups"])  # todo mundo está no grupo padrão

    def test_pessoa_sem_nada_so_ve_as_colecoes_pelo_grupo_padrao(self, client, admin, cenario):
        # Toda coleção nova dá leitura ao grupo "Todos os usuários": é só o que o Joao tem, e vem do grupo
        rows = self._rows(client, admin, search="joao")
        assert rows and all([p["key"] for p in r["permissions"]] == ["colecao.ver"] for r in rows)
        assert all(p["direct"] is False for r in rows for p in r["permissions"])

    def test_administrador_aparece_em_uma_linha(self, client, admin, cenario):
        rows = self._rows(client, admin, search="admin@")
        assert len(rows) == 1 and rows[0]["is_admin"] is True

    def test_filtro_por_permissao_mostra_quem_pode(self, client, admin, cenario):
        rows = self._rows(client, admin, permission="relatorio.excluir")
        emails = {r["email"] for r in rows}
        assert emails == {"maria@example.com", "admin@example.com"}  # admin tem tudo

    def test_filtro_por_colecao_e_global(self, client, admin, cenario):
        so_vendas = self._rows(client, admin, scope=str(cenario["vendas"]))
        alem_de_ver = lambda r: any(p["key"] != "colecao.ver" for p in r["permissions"])  # noqa: E731
        assert {r["email"] for r in so_vendas if not r["is_admin"] and alem_de_ver(r)} == {"maria@example.com"}
        financeiro = self._rows(client, admin, scope=str(cenario["financeiro"]))
        assert not any(alem_de_ver(r) for r in financeiro if not r["is_admin"])
        globais = self._rows(client, admin, scope="global")
        assert all(r["workspace_id"] is None for r in globais)

    def test_filtro_por_grupo_e_so_avulsas(self, client, admin, cenario):
        do_grupo = self._rows(client, admin, group_id=cenario["grupo"])
        assert {r["email"] for r in do_grupo} == {"maria@example.com"}
        avulsas = self._rows(client, admin, only_direct="true")
        assert {r["email"] for r in avulsas} == {"maria@example.com"}
        assert all(r["workspace_id"] == cenario["vendas"] for r in avulsas if any(p["direct"] for p in r["permissions"]))

    def test_parametros_invalidos_dao_422(self, client, admin, cenario):
        assert client.get("/access/report", params={"scope": "abc"}, headers=admin).status_code == 422
        assert client.get("/access/report", params={"permission": "x.y"}, headers=admin).status_code == 422

    def test_filtro_por_pessoa_deixa_so_ela(self, client, admin, cenario):
        rows = self._rows(client, admin, user_id=cenario["maria"])
        assert {r["email"] for r in rows} == {"maria@example.com"}
        # Vendas e global pelo que foi dado a ela; Financeiro só pela leitura do grupo padrão
        assert {r["workspace_id"] for r in rows} == {None, cenario["vendas"], cenario["financeiro"]}

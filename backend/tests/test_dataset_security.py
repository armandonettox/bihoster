"""RLS e OLS por grupo e por pessoa (fase 4). A API do Power BI e sempre simulada e os dados sao ficticios.

O que mais importa aqui: sem mapeamento nada muda, com mapeamento so entra quem tem funcao (falha fechada) e uma mudanca de
grupo ou de mapeamento nunca reaproveita um token feito com as funcoes antigas."""

from unittest.mock import MagicMock, patch

import pytest

from app.core import dataset_security, powerbi as powerbi_core
from app.models.catalog_sync import DatasetRoleGrant, PbiDataset
from app.models.report import Report
from app.models.user import User
from app.models.workspace import Group, GroupMember
from tests.test_powerbi_cache_sharing import _embed, _headers_de, _setup, _token


@pytest.fixture
def cena(client, db_session):
    """Um modelo com RLS (ds-1) usado por um relatorio, outro modelo (ds-2) com outro relatorio, tres pessoas e dois grupos."""
    admin, workspace, (rel1, rel2) = _setup(client, ["ds-1", "ds-2"])
    ana = _headers_de(client, "ana@example.com")
    beto = _headers_de(client, "beto@example.com")
    caio = _headers_de(client, "caio@example.com")
    usuarios = {u.email: u for u in db_session.query(User).all()}
    conexao = db_session.query(Report).filter_by(id=rel1["id"]).one().powerbi_connection_id
    ds1 = PbiDataset(connection_id=conexao, pbi_workspace_id="pbi-ws", pbi_dataset_id="ds-1", name="Modelo 1", is_effective_identity_required=True)
    ds2 = PbiDataset(connection_id=conexao, pbi_workspace_id="pbi-ws", pbi_dataset_id="ds-2", name="Modelo 2", is_effective_identity_required=True)
    regional = Group(name="Regional A")
    nacional = Group(name="Nacional")
    db_session.add_all([ds1, ds2, regional, nacional])
    db_session.commit()
    # Todos veem a colecao para poder abrir os relatorios
    grupo_padrao = db_session.query(Group).filter(Group.is_default.is_(True)).one()
    client.put(
        f"/access/groups/{grupo_padrao.id}",
        json={"blocks": [{"workspace_id": workspace["id"], "permissions": ["colecao.ver"]}]},
        headers=admin,
    )
    return {
        "admin": admin, "ana": ana, "beto": beto, "caio": caio, "workspace": workspace, "rel1": rel1, "rel2": rel2,
        "ds1": ds1, "ds2": ds2, "regional": regional, "nacional": nacional,
        "ana_u": usuarios["ana@example.com"], "beto_u": usuarios["beto@example.com"], "caio_u": usuarios["caio@example.com"],
        "admin_u": usuarios["admin@example.com"],
    }


def _mapear(db_session, dataset, *linhas):
    """linhas: ("g", grupo, "Funcao") ou ("u", pessoa, "Funcao")."""
    db_session.query(DatasetRoleGrant).filter_by(dataset_id=dataset.id).delete()
    for tipo, sujeito, funcao in linhas:
        db_session.add(DatasetRoleGrant(dataset_id=dataset.id, pbi_role=funcao, **({"group_id": sujeito.id} if tipo == "g" else {"user_id": sujeito.id})))
    db_session.commit()


def _entrar_no_grupo(db_session, grupo, pessoa):
    db_session.add(GroupMember(group_id=grupo.id, user_id=pessoa.id))
    db_session.commit()


def _abrir(client, cena, quem, relatorio="rel1", gerador=None):
    gerador = gerador or MagicMock(side_effect=lambda *a, **k: _token(f"tok-{len(gerador.mock_calls)}"))
    resposta = _embed(client, cena[quem], cena["workspace"], cena[relatorio], generate=gerador, rls=True)
    return resposta, gerador


class TestSemMapeamentoTudoComoAntes:
    def test_modelo_sem_funcoes_manda_so_o_email_como_sempre(self, client, cena):
        resposta, gerador = _abrir(client, cena, "ana")

        assert resposta.status_code == 200
        kwargs = gerador.call_args.kwargs
        assert kwargs["username"] == "ana@example.com" and kwargs.get("roles") is None

    def test_o_token_por_pessoa_continua_sendo_por_pessoa(self, client, cena):
        gerador = MagicMock(side_effect=lambda *a, **k: _token(f"tok-{k['username']}"))

        _abrir(client, cena, "ana", gerador=gerador)
        _abrir(client, cena, "beto", gerador=gerador)
        _abrir(client, cena, "ana", gerador=gerador)

        assert gerador.call_count == 2  # ana e beto, e a segunda abertura da ana veio do cache

    def test_modelo_que_o_portal_ainda_nao_sincronizou_tambem_funciona_como_antes(self, client, db_session, cena):
        db_session.query(PbiDataset).delete()
        db_session.commit()

        resposta, gerador = _abrir(client, cena, "ana")

        assert resposta.status_code == 200 and gerador.call_args.kwargs["username"] == "ana@example.com"


class TestComMapeamento:
    def test_a_funcao_do_grupo_da_pessoa_vai_no_token_junto_com_o_email(self, client, db_session, cena):
        _entrar_no_grupo(db_session, cena["regional"], cena["ana_u"])
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"))

        resposta, gerador = _abrir(client, cena, "ana")

        assert resposta.status_code == 200
        kwargs = gerador.call_args.kwargs
        assert kwargs["roles"] == ["Regional A"] and kwargs["username"] == "ana@example.com"
        assert kwargs["dataset_id"] == "ds-1"

    def test_a_pessoa_recebe_a_uniao_das_funcoes_dos_grupos_e_das_dadas_a_ela(self, client, db_session, cena):
        _entrar_no_grupo(db_session, cena["regional"], cena["ana_u"])
        _entrar_no_grupo(db_session, cena["nacional"], cena["ana_u"])
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"), ("g", cena["nacional"], "Nacional"), ("u", cena["ana_u"], "Auditoria"), ("g", cena["nacional"], "Regional A"))

        _, gerador = _abrir(client, cena, "ana")

        assert gerador.call_args.kwargs["roles"] == ["Auditoria", "Nacional", "Regional A"]

    def test_duas_pessoas_de_grupos_diferentes_recebem_tokens_com_funcoes_diferentes(self, client, db_session, cena):
        _entrar_no_grupo(db_session, cena["regional"], cena["ana_u"])
        _entrar_no_grupo(db_session, cena["nacional"], cena["beto_u"])
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"), ("g", cena["nacional"], "Nacional"))
        gerador = MagicMock(side_effect=lambda *a, **k: _token("tok-" + "-".join(k["roles"])))

        r_ana, _ = _abrir(client, cena, "ana", gerador=gerador)
        r_beto, _ = _abrir(client, cena, "beto", gerador=gerador)

        assert r_ana.json()["access_token"] == "tok-Regional A" and r_beto.json()["access_token"] == "tok-Nacional"

    def test_sem_nenhuma_funcao_o_relatorio_nao_abre_e_nenhum_token_e_gerado(self, client, db_session, cena):
        _entrar_no_grupo(db_session, cena["regional"], cena["ana_u"])
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"))

        resposta, gerador = _abrir(client, cena, "beto")

        assert resposta.status_code == 403 and "funcao de seguranca" in resposta.json()["detail"]
        gerador.assert_not_called()

    def test_o_administrador_tambem_precisa_de_uma_funcao(self, client, db_session, cena):
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"))

        negado, gerador = _abrir(client, cena, "admin")
        assert negado.status_code == 403
        gerador.assert_not_called()

        admins = db_session.query(Group).filter(Group.is_admin_group.is_(True)).one()
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"), ("g", admins, "Todos"))
        liberado, gerador = _abrir(client, cena, "admin")
        assert liberado.status_code == 200 and gerador.call_args.kwargs["roles"] == ["Todos"]

    def test_o_mapeamento_de_um_modelo_nao_vale_para_o_relatorio_de_outro(self, client, db_session, cena):
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"))

        resposta, gerador = _abrir(client, cena, "beto", relatorio="rel2")

        assert resposta.status_code == 200 and gerador.call_args.kwargs.get("roles") is None

    def test_modelo_sem_rls_ignora_o_mapeamento_e_nao_manda_identidade(self, client, db_session, cena):
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"))
        gerador = MagicMock(return_value=_token())

        resposta = _embed(client, cena["beto"], cena["workspace"], cena["rel1"], generate=gerador, rls=False)

        assert resposta.status_code == 200
        kwargs = gerador.call_args.kwargs
        assert kwargs.get("username") is None and kwargs.get("roles") is None

    def test_funcao_invalida_no_banco_nao_chega_ao_token_de_quem_nao_e_do_grupo(self, client, db_session, cena):
        _entrar_no_grupo(db_session, cena["regional"], cena["ana_u"])
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"), ("u", cena["beto_u"], "Outra"))

        _, gerador = _abrir(client, cena, "ana")

        assert gerador.call_args.kwargs["roles"] == ["Regional A"]


class TestCacheNaoReaproveitaFuncaoAntiga:
    def test_mudar_a_funcao_do_grupo_gera_um_token_novo(self, client, db_session, cena):
        _entrar_no_grupo(db_session, cena["regional"], cena["ana_u"])
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"))
        gerador = MagicMock(side_effect=lambda *a, **k: _token("tok-" + "-".join(k["roles"])))

        antes, _ = _abrir(client, cena, "ana", gerador=gerador)
        _abrir(client, cena, "ana", gerador=gerador)  # do cache
        assert gerador.call_count == 1
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional B"))
        depois, _ = _abrir(client, cena, "ana", gerador=gerador)

        assert antes.json()["access_token"] == "tok-Regional A" and depois.json()["access_token"] == "tok-Regional B"

    def test_sair_do_grupo_fecha_o_relatorio_mesmo_com_token_em_cache(self, client, db_session, cena):
        _entrar_no_grupo(db_session, cena["regional"], cena["ana_u"])
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"))
        assert _abrir(client, cena, "ana")[0].status_code == 200

        db_session.query(GroupMember).filter_by(group_id=cena["regional"].id, user_id=cena["ana_u"].id).delete()
        db_session.commit()
        resposta, gerador = _abrir(client, cena, "ana")

        assert resposta.status_code == 403
        gerador.assert_not_called()

    def test_tirar_todo_o_mapeamento_volta_ao_comportamento_de_antes(self, client, db_session, cena):
        _entrar_no_grupo(db_session, cena["regional"], cena["ana_u"])
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"))
        _abrir(client, cena, "ana")
        _mapear(db_session, cena["ds1"])

        resposta, gerador = _abrir(client, cena, "beto")

        assert resposta.status_code == 200 and gerador.call_args.kwargs["username"] == "beto@example.com"

    def test_o_token_antigo_por_pessoa_nao_e_servido_depois_que_o_mapeamento_liga(self, client, db_session, cena):
        antigo, _ = _abrir(client, cena, "ana")  # sem mapeamento: token por pessoa
        assert antigo.status_code == 200
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"))

        resposta, gerador = _abrir(client, cena, "ana")

        assert resposta.status_code == 403
        gerador.assert_not_called()


class TestTokenDivididoPorFuncoes:
    def test_modelo_so_por_funcao_divide_o_token_entre_quem_tem_o_mesmo_conjunto(self, client, db_session, cena):
        _entrar_no_grupo(db_session, cena["regional"], cena["ana_u"])
        _entrar_no_grupo(db_session, cena["regional"], cena["beto_u"])
        _entrar_no_grupo(db_session, cena["nacional"], cena["caio_u"])
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"), ("g", cena["nacional"], "Nacional"))
        cena["ds1"].rls_shared_by_roles = True
        db_session.commit()
        gerador = MagicMock(side_effect=lambda *a, **k: _token("tok-" + "-".join(k["roles"])))

        _abrir(client, cena, "ana", gerador=gerador)
        _abrir(client, cena, "beto", gerador=gerador)
        _abrir(client, cena, "caio", gerador=gerador)

        assert gerador.call_count == 2  # ana e beto dividem; o caio tem outra funcao
        for chamada in gerador.call_args_list:
            assert chamada.kwargs["username"] == dataset_security.SHARED_USERNAME  # nunca o e-mail de uma pessoa

    def test_sem_a_marca_cada_pessoa_tem_o_proprio_token_mesmo_com_a_mesma_funcao(self, client, db_session, cena):
        _entrar_no_grupo(db_session, cena["regional"], cena["ana_u"])
        _entrar_no_grupo(db_session, cena["regional"], cena["beto_u"])
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "Regional A"))
        gerador = MagicMock(side_effect=lambda *a, **k: _token("tok-" + k["username"]))

        _abrir(client, cena, "ana", gerador=gerador)
        _abrir(client, cena, "beto", gerador=gerador)

        assert gerador.call_count == 2
        assert {c.kwargs["username"] for c in gerador.call_args_list} == {"ana@example.com", "beto@example.com"}


class TestUnitarios:
    def test_nome_de_funcao_e_limpo_e_validado(self):
        assert dataset_security.clean_role("  Regional A  ") == "Regional A"
        for ruim in ("", "   ", "x" * 201, "com\nquebra"):
            with pytest.raises(ValueError):
                dataset_security.clean_role(ruim)

    def test_a_chave_do_cache_leva_as_funcoes(self):
        a = dataset_security.EmbedIdentity("u@e", ("A",), shared=False)
        b = dataset_security.EmbedIdentity("u@e", ("B",), shared=False)
        compartilhada = dataset_security.EmbedIdentity("x", ("A",), shared=True)

        assert a.cache_part(1) != b.cache_part(1)
        assert a.cache_part(1) != a.cache_part(2)
        assert compartilhada.cache_part(1) == compartilhada.cache_part(2)


class TestApi:
    def _put(self, client, cena, corpo, como="admin"):
        return client.put(f"/catalog/datasets/{cena['ds1'].id}/security", json=corpo, headers=cena[como])

    def test_so_quem_tem_a_permissao_ve_e_muda(self, client, cena):
        assert client.get(f"/catalog/datasets/{cena['ds1'].id}/security", headers=cena["ana"]).status_code == 403
        assert self._put(client, cena, {"grants": []}, como="ana").status_code == 403
        assert client.post(f"/catalog/datasets/{cena['ds1'].id}/security/test", json={"pbi_role": "A"}, headers=cena["ana"]).status_code == 403

    def test_a_permissao_exige_ver_o_catalogo_de_modelos(self, client, db_session, cena):
        resposta = client.put(f"/access/users/{cena['ana_u'].id}", json={"blocks": [{"workspace_id": None, "permissions": ["modelo.seguranca"]}]}, headers=cena["admin"])
        assert resposta.status_code == 200

        assert client.get("/catalog/datasets", headers=cena["ana"]).status_code == 200  # "requires" ligou modelo.catalogo
        assert client.get(f"/catalog/datasets/{cena['ds1'].id}/security", headers=cena["ana"]).status_code == 200

    def test_grava_le_e_o_modelo_passa_a_exigir_funcao(self, client, db_session, cena):
        corpo = {"rls_shared_by_roles": False, "grants": [{"group_id": cena["regional"].id, "pbi_role": " Regional A "}, {"user_id": cena["beto_u"].id, "pbi_role": "Auditoria"}]}

        resposta = self._put(client, cena, corpo)

        assert resposta.status_code == 200
        dados = resposta.json()
        assert dados["active"] is True and dados["reports_count"] == 1
        assert [(g["subject_name"], g["pbi_role"]) for g in dados["grants"]] == [("Beto", "Auditoria"), ("Regional A", "Regional A")]
        assert _abrir(client, cena, "caio")[0].status_code == 403

    def test_sem_linhas_o_modelo_volta_ao_comportamento_de_antes(self, client, cena):
        self._put(client, cena, {"grants": [{"group_id": cena["regional"].id, "pbi_role": "A"}]})

        resposta = self._put(client, cena, {"grants": []})

        assert resposta.json()["active"] is False
        assert _abrir(client, cena, "caio")[0].status_code == 200

    def test_gravar_descarta_o_token_em_cache_dos_relatorios_do_modelo(self, client, db_session, cena):
        _entrar_no_grupo(db_session, cena["regional"], cena["ana_u"])
        self._put(client, cena, {"grants": [{"group_id": cena["regional"].id, "pbi_role": "A"}]})
        gerador = MagicMock(side_effect=lambda *a, **k: _token("tok" + str(len(gerador.mock_calls))))
        _abrir(client, cena, "ana", gerador=gerador)

        self._put(client, cena, {"grants": [{"group_id": cena["regional"].id, "pbi_role": "A"}]})  # mesma funcao, mesmo assim limpa
        _abrir(client, cena, "ana", gerador=gerador)

        assert gerador.call_count == 2

    def test_recusa_o_que_nao_e_valido(self, client, cena):
        assert self._put(client, cena, {"grants": [{"pbi_role": "A"}]}).status_code == 422  # sem grupo nem pessoa
        assert self._put(client, cena, {"grants": [{"group_id": cena["regional"].id, "user_id": cena["ana_u"].id, "pbi_role": "A"}]}).status_code == 422
        assert self._put(client, cena, {"grants": [{"group_id": cena["regional"].id, "pbi_role": "   "}]}).status_code == 422
        assert self._put(client, cena, {"grants": [{"group_id": 99999, "pbi_role": "A"}]}).status_code == 404
        assert self._put(client, cena, {"grants": [{"user_id": 99999, "pbi_role": "A"}]}).status_code == 404
        assert client.put("/catalog/datasets/99999/security", json={"grants": []}, headers=cena["admin"]).status_code == 404

    def test_linhas_repetidas_viram_uma(self, client, db_session, cena):
        linha = {"group_id": cena["regional"].id, "pbi_role": "A"}

        self._put(client, cena, {"grants": [linha, linha, {**linha, "pbi_role": "A"}]})

        assert db_session.query(DatasetRoleGrant).count() == 1

    def test_a_lista_de_modelos_diz_quantas_funcoes_cada_um_tem(self, client, db_session, cena):
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "A"), ("g", cena["nacional"], "B"))

        itens = {i["name"]: i for i in client.get("/catalog/datasets", headers=cena["admin"]).json()["items"]}

        assert itens["Modelo 1"]["role_grants"] == 2 and itens["Modelo 2"]["role_grants"] == 0

    def test_excluir_o_grupo_ou_a_pessoa_apaga_a_funcao_mapeada(self, client, db_session, cena):
        _mapear(db_session, cena["ds1"], ("g", cena["regional"], "A"), ("u", cena["beto_u"], "B"))

        assert client.delete(f"/groups/{cena['regional'].id}", headers=cena["admin"]).status_code in (200, 204)
        assert db_session.query(DatasetRoleGrant).count() == 1
        assert client.delete(f"/users/{cena['beto_u'].id}", headers=cena["admin"]).status_code in (200, 204)
        assert db_session.query(DatasetRoleGrant).count() == 0

    def test_testar_a_funcao_nao_devolve_o_token_e_usa_um_usuario_so_do_teste(self, client, cena):
        gerador = MagicMock(return_value=_token("segredo-do-token"))

        with patch.object(powerbi_core, "generate_embed_token", gerador):
            resposta = client.post(f"/catalog/datasets/{cena['ds1'].id}/security/test", json={"pbi_role": "Regional A"}, headers=cena["admin"])

        assert resposta.json() == {"ok": True, "message": "O Power BI aceitou a funcao."}
        assert "segredo-do-token" not in resposta.text
        kwargs = gerador.call_args.kwargs
        assert kwargs["roles"] == ["Regional A"] and kwargs["username"] == "bihoster-teste" and kwargs["dataset_id"] == "ds-1"

    def test_testar_mostra_o_motivo_quando_o_power_bi_recusa(self, client, cena):
        recusa = MagicMock(side_effect=powerbi_core.PowerBIError("Falha ao gerar embed token: HTTP 400 -- funcao inexistente"))

        with patch.object(powerbi_core, "generate_embed_token", recusa):
            resposta = client.post(f"/catalog/datasets/{cena['ds1'].id}/security/test", json={"pbi_role": "Nao existe"}, headers=cena["admin"])

        assert resposta.json()["ok"] is False and "funcao inexistente" in resposta.json()["message"]

    def test_testar_sem_relatorio_do_modelo_explica_o_que_falta(self, client, db_session, cena):
        db_session.query(Report).delete()
        db_session.commit()

        resposta = client.post(f"/catalog/datasets/{cena['ds1'].id}/security/test", json={"pbi_role": "A"}, headers=cena["admin"])

        assert resposta.json()["ok"] is False and "cadastre um" in resposta.json()["message"]

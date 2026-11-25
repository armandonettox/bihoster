"""Modo TV: o cadastro das TVs com as permissoes de cada uma, a lista de itens, o link secreto, o codigo que muda com o
tempo e a conexao da propria TV. Nenhum teste fala com o Power BI."""

from unittest.mock import patch

import pytest

from app.core import powerbi, tv as tv_core
from app.models.audit_log import AuditLog
from app.models.tv import Tv
from tests.test_report_delivery import _headers, _pbi, cenario  # noqa: F401  (cenario e fixture)

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def _id(client, admin, email):
    return next(u["id"] for u in client.get("/users/", headers=admin).json() if u["email"] == email)


@pytest.fixture
def tvs(client, cenario):
    """Cenario do Modo TV: o administrador, uma pessoa com 'criar TVs', outra sem nada, e uma TV do administrador."""
    pessoa = _headers(client, "pessoa@example.com")
    outra = _headers(client, "outra@example.com")
    pessoa_id = _id(client, cenario.admin, "pessoa@example.com")
    outra_id = _id(client, cenario.admin, "outra@example.com")
    resp = client.put(
        f"/access/users/{pessoa_id}", json={"blocks": [{"workspace_id": None, "permissions": ["tv.criar"]}]}, headers=cenario.admin
    )
    assert resp.status_code == 200, resp.text
    tv = client.post("/tvs", json={"name": "Recepcao"}, headers=cenario.admin).json()
    cenario.pessoa, cenario.outra, cenario.pessoa_id, cenario.outra_id, cenario.tv = pessoa, outra, pessoa_id, outra_id, tv
    return cenario


def _tirar_a_leitura_do_grupo_padrao(client, c):
    """Todo mundo le as colecoes pelo grupo padrao; tira isso para ter alguem que NAO enxerga a colecao."""
    padrao = next(g for g in client.get("/groups/", headers=c.admin).json() if g["is_default"])
    resp = client.put(f"/access/groups/{padrao['id']}", json={"blocks": []}, headers=c.admin)
    assert resp.status_code == 200, resp.text


def _dar(client, c, tv_id, grants, headers=None):
    resp = client.put(f"/tvs/{tv_id}/grants", json={"grants": grants}, headers=headers or c.admin)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _segredos(db_session, tv_id):
    row = db_session.query(Tv).get(tv_id)
    return row.link_secret, row


class TestCriarEListar:
    def test_so_quem_tem_criar_tvs_cria(self, client, tvs):
        assert client.post("/tvs", json={"name": "X"}, headers=tvs.outra).status_code == 403
        resp = client.post("/tvs", json={"name": "  Sala de reuniao  "}, headers=tvs.pessoa)
        assert resp.status_code == 201
        assert resp.json()["name"] == "Sala de reuniao" and resp.json()["level"] == "modificar"

    def test_quem_cria_pode_modificar_a_propria_tv(self, client, tvs):
        criada = client.post("/tvs", json={"name": "Minha"}, headers=tvs.pessoa).json()

        assert client.put(f"/tvs/{criada['id']}", json={"name": "Minha 2"}, headers=tvs.pessoa).status_code == 200
        assert [t["name"] for t in client.get("/tvs", headers=tvs.pessoa).json()] == ["Minha 2"]

    def test_nome_vazio_e_recusado(self, client, tvs):
        assert client.post("/tvs", json={"name": "   "}, headers=tvs.admin).status_code == 422

    def test_a_lista_mostra_so_as_tvs_do_nivel_da_pessoa(self, client, tvs):
        assert client.get("/tvs", headers=tvs.outra).json() == []
        _dar(client, tvs, tvs.tv["id"], [{"user_id": tvs.outra_id, "level": "ver"}])

        lista = client.get("/tvs", headers=tvs.outra).json()

        assert [(t["name"], t["level"]) for t in lista] == [("Recepcao", "ver")]

    def test_administrador_ve_todas_com_modificar(self, client, tvs):
        client.post("/tvs", json={"name": "Outra TV"}, headers=tvs.pessoa)

        lista = client.get("/tvs", headers=tvs.admin).json()

        assert {t["name"]: t["level"] for t in lista} == {"Recepcao": "modificar", "Outra TV": "modificar"}

    def test_tv_sem_acesso_responde_404_sem_revelar_que_existe(self, client, tvs):
        assert client.get(f"/tvs/{tvs.tv['id']}", headers=tvs.outra).status_code == 404
        assert client.get("/tvs/9999", headers=tvs.outra).status_code == 404


class TestPermissoesPorTv:
    def test_ver_inclui_utilizar_mas_nao_modificar(self, client, tvs):
        _dar(client, tvs, tvs.tv["id"], [{"user_id": tvs.outra_id, "level": "ver"}])
        tv_id = tvs.tv["id"]

        assert client.get(f"/tvs/{tv_id}", headers=tvs.outra).status_code == 200
        assert client.get(f"/tvs/{tv_id}/code", headers=tvs.outra).status_code == 200
        assert client.post(f"/tvs/{tv_id}/disconnect", headers=tvs.outra).status_code == 204
        assert client.put(f"/tvs/{tv_id}", json={"name": "Z"}, headers=tvs.outra).status_code == 403
        assert client.put(f"/tvs/{tv_id}/items", json={"items": []}, headers=tvs.outra).status_code == 403
        assert client.delete(f"/tvs/{tv_id}", headers=tvs.outra).status_code == 403
        assert client.post(f"/tvs/{tv_id}/regenerate-link", headers=tvs.outra).status_code == 403
        assert client.get(f"/tvs/{tv_id}/grants", headers=tvs.outra).status_code == 403
        assert client.put(f"/tvs/{tv_id}/grants", json={"grants": []}, headers=tvs.outra).status_code == 403

    def test_modificar_inclui_ver_e_mexe_na_tv(self, client, tvs):
        _dar(client, tvs, tvs.tv["id"], [{"user_id": tvs.outra_id, "level": "modificar"}])
        tv_id = tvs.tv["id"]

        assert client.get(f"/tvs/{tv_id}", headers=tvs.outra).json()["level"] == "modificar"
        assert client.put(f"/tvs/{tv_id}", json={"name": "Nova"}, headers=tvs.outra).status_code == 200
        assert client.put(f"/tvs/{tv_id}/items", json={"items": []}, headers=tvs.outra).status_code == 200

    def test_permissao_de_um_grupo_vale_para_quem_esta_nele(self, client, tvs):
        grupo = client.post("/groups/", json={"name": "Recepcionistas"}, headers=tvs.admin).json()
        client.post(f"/groups/{grupo['id']}/members", json={"email": "outra@example.com"}, headers=tvs.admin)
        _dar(client, tvs, tvs.tv["id"], [{"group_id": grupo["id"], "level": "ver"}])

        assert [t["name"] for t in client.get("/tvs", headers=tvs.outra).json()] == ["Recepcao"]

    def test_vale_o_nivel_maior_quando_ha_pessoa_e_grupo(self, client, tvs):
        grupo = client.post("/groups/", json={"name": "Recepcionistas"}, headers=tvs.admin).json()
        client.post(f"/groups/{grupo['id']}/members", json={"email": "outra@example.com"}, headers=tvs.admin)
        _dar(
            client,
            tvs,
            tvs.tv["id"],
            [{"group_id": grupo["id"], "level": "ver"}, {"user_id": tvs.outra_id, "level": "modificar"}],
        )

        assert client.get("/tvs", headers=tvs.outra).json()[0]["level"] == "modificar"

    def test_a_tv_nao_depende_do_acesso_aos_relatorios_da_colecao(self, client, tvs):
        # Quem assiste a TV nao precisa ver a colecao: o acesso e da TV
        _dar(client, tvs, tvs.tv["id"], [{"user_id": tvs.outra_id, "level": "ver"}])

        assert client.get(f"/tvs/{tvs.tv['id']}", headers=tvs.outra).status_code == 200

    def test_a_mesma_pessoa_duas_vezes_fica_com_o_nivel_maior(self, client, tvs):
        saida = _dar(
            client, tvs, tvs.tv["id"], [{"user_id": tvs.outra_id, "level": "ver"}, {"user_id": tvs.outra_id, "level": "modificar"}]
        )

        assert len(saida) == 1 and saida[0]["level"] == "modificar"

    def test_permissao_de_pessoa_ou_grupo_inexistente_e_recusada(self, client, tvs):
        tv_id = tvs.tv["id"]
        for grant in ({"user_id": 9999, "level": "ver"}, {"group_id": 9999, "level": "ver"}):
            assert client.put(f"/tvs/{tv_id}/grants", json={"grants": [grant]}, headers=tvs.admin).status_code == 404
        assert client.put(f"/tvs/{tv_id}/grants", json={"grants": [{"level": "ver"}]}, headers=tvs.admin).status_code == 422
        assert (
            client.put(
                f"/tvs/{tv_id}/grants", json={"grants": [{"user_id": 1, "group_id": 1, "level": "ver"}]}, headers=tvs.admin
            ).status_code
            == 422
        )

    def test_listar_pessoas_so_para_quem_pode_modificar_alguma_tv(self, client, tvs):
        assert client.get("/tvs/people", headers=tvs.outra).status_code == 403
        _dar(client, tvs, tvs.tv["id"], [{"user_id": tvs.outra_id, "level": "ver"}])
        assert client.get("/tvs/people", headers=tvs.outra).status_code == 403
        _dar(client, tvs, tvs.tv["id"], [{"user_id": tvs.outra_id, "level": "modificar"}])

        resp = client.get("/tvs/people", headers=tvs.outra)

        assert resp.status_code == 200
        assert "pessoa@example.com" in [u["email"] for u in resp.json()["users"]]

    def test_o_acesso_do_modulo_aparece_no_meu_acesso(self, client, tvs):
        assert client.get("/access/me", headers=tvs.outra).json()["tv_access"] is False
        _dar(client, tvs, tvs.tv["id"], [{"user_id": tvs.outra_id, "level": "ver"}])

        assert client.get("/access/me", headers=tvs.outra).json()["tv_access"] is True
        assert client.get("/access/me", headers=tvs.pessoa).json()["tv_access"] is True  # pode criar TVs


class TestConfiguracao:
    def test_tempo_de_conexao_vazio_significa_para_sempre(self, client, tvs):
        tv_id = tvs.tv["id"]
        resp = client.put(f"/tvs/{tv_id}", json={"session_hours": 48}, headers=tvs.admin)
        assert resp.json()["session_hours"] == 48

        resp = client.put(f"/tvs/{tv_id}", json={"session_hours": None}, headers=tvs.admin)

        assert resp.json()["session_hours"] is None

    def test_editar_so_o_nome_nao_mexe_no_tempo_de_conexao(self, client, tvs):
        tv_id = tvs.tv["id"]
        client.put(f"/tvs/{tv_id}", json={"session_hours": 24}, headers=tvs.admin)

        resp = client.put(f"/tvs/{tv_id}", json={"name": "Outro nome"}, headers=tvs.admin)

        assert resp.json()["session_hours"] == 24

    def test_tempo_de_conexao_fora_do_limite_e_recusado(self, client, tvs):
        for horas in (0, -1, 24 * 365 + 1):
            assert client.put(f"/tvs/{tvs.tv['id']}", json={"session_hours": horas}, headers=tvs.admin).status_code == 422

    def test_atualizacao_dos_dados_vazia_significa_nao_atualizar(self, client, tvs):
        tv_id = tvs.tv["id"]
        assert client.get(f"/tvs/{tv_id}", headers=tvs.admin).json()["refresh_minutes"] is None

        resp = client.put(f"/tvs/{tv_id}", json={"refresh_minutes": 15}, headers=tvs.admin)
        assert resp.json()["refresh_minutes"] == 15

        resp = client.put(f"/tvs/{tv_id}", json={"name": "Outro nome"}, headers=tvs.admin)
        assert resp.json()["refresh_minutes"] == 15

        resp = client.put(f"/tvs/{tv_id}", json={"refresh_minutes": None}, headers=tvs.admin)
        assert resp.json()["refresh_minutes"] is None

    def test_atualizacao_dos_dados_fora_do_limite_e_recusada(self, client, tvs):
        for minutos in (0, -5, 24 * 60 + 1):
            assert client.put(f"/tvs/{tvs.tv['id']}", json={"refresh_minutes": minutos}, headers=tvs.admin).status_code == 422

    def test_excluir_a_tv_leva_itens_e_permissoes(self, client, tvs, db_session):
        tv_id = tvs.tv["id"]
        _dar(client, tvs, tv_id, [{"user_id": tvs.outra_id, "level": "ver"}])

        assert client.delete(f"/tvs/{tv_id}", headers=tvs.admin).status_code == 204

        assert client.get(f"/tvs/{tv_id}", headers=tvs.admin).status_code == 404
        assert client.get("/tvs", headers=tvs.outra).json() == []


class TestItens:
    def _relatorio_visivel(self, client, tvs):
        return tvs.rel["id"]

    def test_imagem_enviada_entra_na_lista_com_o_tempo(self, client, tvs):
        tv_id = tvs.tv["id"]
        url = client.post(f"/tvs/{tv_id}/image", files={"file": ("foto.png", PNG, "image/png")}, headers=tvs.admin).json()["image_url"]

        resp = client.put(f"/tvs/{tv_id}/items", json={"items": [{"kind": "image", "seconds": 20, "image_url": url}]}, headers=tvs.admin)

        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert (item["kind"], item["seconds"], item["image_url"]) == ("image", 20, url)

    def test_envio_confere_o_conteudo_e_nao_o_tipo_informado(self, client, tvs):
        tv_id = tvs.tv["id"]
        falso = client.post(f"/tvs/{tv_id}/image", files={"file": ("a.png", b"<svg onload=alert(1)>", "image/png")}, headers=tvs.admin)
        assert falso.status_code == 400
        for nome, conteudo in (("a.jpg", b"\xff\xd8\xff" + b"0" * 20), ("a.gif", b"GIF89a" + b"0" * 20), ("a.webp", b"RIFF0000WEBP" + b"0" * 20)):
            assert client.post(f"/tvs/{tv_id}/image", files={"file": (nome, conteudo, "application/octet-stream")}, headers=tvs.admin).status_code == 200

    def test_imagem_grande_demais_e_recusada(self, client, tvs):
        grande = PNG + b"0" * (10 * 1024 * 1024)

        resp = client.post(f"/tvs/{tvs.tv['id']}/image", files={"file": ("a.png", grande, "image/png")}, headers=tvs.admin)

        assert resp.status_code == 413

    def test_so_quem_modifica_envia_imagem(self, client, tvs):
        _dar(client, tvs, tvs.tv["id"], [{"user_id": tvs.outra_id, "level": "ver"}])

        resp = client.post(f"/tvs/{tvs.tv['id']}/image", files={"file": ("a.png", PNG, "image/png")}, headers=tvs.outra)

        assert resp.status_code == 403

    def test_item_de_imagem_so_aceita_arquivo_enviado_pelo_sistema(self, client, tvs):
        tv_id = tvs.tv["id"]
        for url in ("https://exemplo.com/a.png", "/static/uploads/logo.png", "/static/uploads/tv/../x.png", ""):
            resp = client.put(f"/tvs/{tv_id}/items", json={"items": [{"kind": "image", "seconds": 10, "image_url": url}]}, headers=tvs.admin)
            assert resp.status_code == 422, url

    @pytest.mark.parametrize(
        "link",
        [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ?t=10",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x",
        ],
    )
    def test_link_do_youtube_vira_o_id_do_video(self, client, tvs, link):
        resp = client.put(
            f"/tvs/{tvs.tv['id']}/items",
            json={"items": [{"kind": "youtube", "seconds": 60, "video_url": link, "sound": True}]},
            headers=tvs.admin,
        )

        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert (item["video_id"], item["sound"]) == ("dQw4w9WgXcQ", True)

    @pytest.mark.parametrize("link", ["", "https://exemplo.com/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "https://youtube.com/watch?v=curto", "texto"])
    def test_link_que_nao_e_do_youtube_e_recusado(self, client, tvs, link):
        resp = client.put(f"/tvs/{tvs.tv['id']}/items", json={"items": [{"kind": "youtube", "seconds": 60, "video_url": link}]}, headers=tvs.admin)

        assert resp.status_code == 422

    def test_pagina_de_relatorio_entra_com_o_relatorio_e_a_pagina(self, client, tvs):
        p1, p2 = _pbi()
        with p1, p2:
            resp = client.put(
                f"/tvs/{tvs.tv['id']}/items",
                json={"items": [{"kind": "report_page", "seconds": 30, "report_id": tvs.rel["id"], "page_name": "ReportSection2"}]},
                headers=tvs.admin,
            )

        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert (item["report_name"], item["collection_name"], item["page_name"]) == ("Vendas", "Comercial", "ReportSection2")

    def test_relatorio_com_seguranca_por_linha_nao_entra(self, client, tvs):
        p1, p2 = _pbi(rls=True)
        with p1, p2:
            resp = client.put(
                f"/tvs/{tvs.tv['id']}/items",
                json={"items": [{"kind": "report_page", "seconds": 30, "report_id": tvs.rel["id"], "page_name": "P1"}]},
                headers=tvs.admin,
            )

        assert resp.status_code == 400 and "RLS" in resp.json()["detail"]

    def test_quem_monta_so_escolhe_relatorio_que_ele_mesmo_ve(self, client, tvs):
        _tirar_a_leitura_do_grupo_padrao(client, tvs)
        _dar(client, tvs, tvs.tv["id"], [{"user_id": tvs.outra_id, "level": "modificar"}])
        p1, p2 = _pbi()
        with p1, p2:
            resp = client.put(
                f"/tvs/{tvs.tv['id']}/items",
                json={"items": [{"kind": "report_page", "seconds": 30, "report_id": tvs.rel["id"], "page_name": "P1"}]},
                headers=tvs.outra,
            )

        assert resp.status_code == 403

    def test_relatorio_que_ja_estava_na_tv_continua_valendo_para_quem_nao_o_ve(self, client, tvs):
        """O administrador coloca uma tela que o grupo nao enxerga; quem so edita a ordem nao e barrado."""
        tv_id = tvs.tv["id"]
        item = {"kind": "report_page", "seconds": 30, "report_id": tvs.rel["id"], "page_name": "P1"}
        p1, p2 = _pbi()
        with p1, p2:
            assert client.put(f"/tvs/{tv_id}/items", json={"items": [item]}, headers=tvs.admin).status_code == 200
        _dar(client, tvs, tv_id, [{"user_id": tvs.outra_id, "level": "modificar"}])

        resp = client.put(f"/tvs/{tv_id}/items", json={"items": [{**item, "seconds": 45}]}, headers=tvs.outra)

        assert resp.status_code == 200 and resp.json()["items"][0]["seconds"] == 45

    def test_a_ordem_e_guardada_e_o_tempo_tem_limites(self, client, tvs):
        tv_id = tvs.tv["id"]
        itens = [{"kind": "youtube", "seconds": 10 * (i + 1), "video_url": "https://youtu.be/dQw4w9WgXcQ"} for i in range(3)]
        ordem = client.put(f"/tvs/{tv_id}/items", json={"items": list(reversed(itens))}, headers=tvs.admin).json()["items"]
        assert [i["seconds"] for i in ordem] == [30, 20, 10]

        for segundos in (0, 2, 3601):
            resp = client.put(f"/tvs/{tv_id}/items", json={"items": [{**itens[0], "seconds": segundos}]}, headers=tvs.admin)
            assert resp.status_code == 422

    def test_trocar_a_lista_apaga_a_imagem_que_saiu(self, client, tvs):
        from app.routers import tvs as tvs_router

        tv_id = tvs.tv["id"]
        url = client.post(f"/tvs/{tv_id}/image", files={"file": ("a.png", PNG, "image/png")}, headers=tvs.admin).json()["image_url"]
        client.put(f"/tvs/{tv_id}/items", json={"items": [{"kind": "image", "seconds": 10, "image_url": url}]}, headers=tvs.admin)
        arquivo = tvs_router.TV_UPLOAD_DIR / url.removeprefix("/static/uploads/tv/")
        assert arquivo.exists()

        client.put(f"/tvs/{tv_id}/items", json={"items": []}, headers=tvs.admin)

        assert not arquivo.exists()

    def test_tipo_de_item_desconhecido_e_item_de_relatorio_incompleto_sao_recusados(self, client, tvs):
        tv_id = tvs.tv["id"]
        assert client.put(f"/tvs/{tv_id}/items", json={"items": [{"kind": "video", "seconds": 10}]}, headers=tvs.admin).status_code == 422
        assert (
            client.put(f"/tvs/{tv_id}/items", json={"items": [{"kind": "report_page", "seconds": 10}]}, headers=tvs.admin).status_code == 422
        )

    def test_relatorios_disponiveis_sao_os_das_colecoes_que_a_pessoa_ve(self, client, tvs):
        _tirar_a_leitura_do_grupo_padrao(client, tvs)
        resp = client.get("/tvs/available-reports", headers=tvs.admin)
        assert [(r["name"], r["collection_name"]) for r in resp.json()] == [("Vendas", "Comercial")]

        # Quem pode criar TVs mas nao ve a colecao nao ve o relatorio; quem so olha uma TV nao monta lista
        assert client.get("/tvs/available-reports", headers=tvs.pessoa).json() == []
        assert client.get("/tvs/available-reports", headers=tvs.outra).status_code == 403

    def test_paginas_do_relatorio_vem_do_power_bi(self, client, tvs):
        paginas = [{"name": "P1", "displayName": "Resumo"}, {"name": "P2", "displayName": "Detalhe"}]
        with patch.object(powerbi, "list_pages", return_value=paginas):
            resp = client.get(f"/tvs/report-pages/{tvs.rel['id']}", headers=tvs.admin)

        assert [(p["name"], p["title"]) for p in resp.json()] == [("P1", "Resumo"), ("P2", "Detalhe")]

    def test_paginas_de_relatorio_de_colecao_sem_acesso_dao_404(self, client, tvs):
        _tirar_a_leitura_do_grupo_padrao(client, tvs)
        assert client.get(f"/tvs/report-pages/{tvs.rel['id']}", headers=tvs.outra).status_code == 404


class TestCodigoELink:
    def test_o_codigo_tem_seis_digitos_e_diz_quanto_falta_para_mudar(self, client, tvs):
        resp = client.get(f"/tvs/{tvs.tv['id']}/code", headers=tvs.admin).json()

        assert len(resp["code"]) == 6 and resp["code"].isdigit()
        assert 0 < resp["expires_in_seconds"] <= tv_core.CODE_STEP_SECONDS

    def test_o_codigo_muda_de_uma_janela_para_outra(self, db_session, client, tvs):
        _, row = _segredos(db_session, tvs.tv["id"])
        agora = 1_000_000.0

        codigo_a, _ = tv_core.current_code(row, agora)
        codigo_b, _ = tv_core.current_code(row, agora + tv_core.CODE_STEP_SECONDS)
        mesmo_instante, _ = tv_core.current_code(row, agora + 1)

        assert codigo_a != codigo_b and codigo_a == mesmo_instante

    def test_cada_tv_tem_o_seu_codigo(self, client, tvs):
        outra = client.post("/tvs", json={"name": "Outra"}, headers=tvs.admin).json()

        a = client.get(f"/tvs/{tvs.tv['id']}/code", headers=tvs.admin).json()["code"]
        b = client.get(f"/tvs/{outra['id']}/code", headers=tvs.admin).json()["code"]

        assert a != b

    def test_o_codigo_da_janela_anterior_ainda_vale_e_o_de_duas_janelas_atras_nao(self, db_session, client, tvs):
        _, row = _segredos(db_session, tvs.tv["id"])
        agora = 5_000_000.0
        anterior, _ = tv_core.current_code(row, agora - tv_core.CODE_STEP_SECONDS)
        antigo, _ = tv_core.current_code(row, agora - 2 * tv_core.CODE_STEP_SECONDS)

        assert tv_core.code_is_valid(row, anterior, agora)
        assert not tv_core.code_is_valid(row, antigo, agora)
        assert not tv_core.code_is_valid(row, "", agora)

    def test_trocar_o_link_muda_o_endereco_e_o_antigo_para_de_servir(self, client, tvs):
        antes = client.get(f"/tvs/{tvs.tv['id']}", headers=tvs.admin).json()["link_secret"]

        depois = client.post(f"/tvs/{tvs.tv['id']}/regenerate-link", headers=tvs.admin).json()["link_secret"]

        assert antes != depois and len(depois) >= 40
        assert client.get(f"/tv-player/{antes}/name").status_code == 404
        assert client.get(f"/tv-player/{depois}/name").status_code == 200

    def test_ver_a_tv_mostra_o_link_para_quem_so_pode_ver(self, client, tvs):
        _dar(client, tvs, tvs.tv["id"], [{"user_id": tvs.outra_id, "level": "ver"}])

        resp = client.get(f"/tvs/{tvs.tv['id']}", headers=tvs.outra).json()

        assert resp["link_secret"]

    def test_auditoria_registra_as_acoes_das_tvs(self, client, tvs, db_session):
        client.put(f"/tvs/{tvs.tv['id']}", json={"name": "Nova"}, headers=tvs.admin)
        client.post(f"/tvs/{tvs.tv['id']}/disconnect", headers=tvs.admin)
        client.post(f"/tvs/{tvs.tv['id']}/regenerate-link", headers=tvs.admin)

        acoes = {a.action for a in db_session.query(AuditLog).filter(AuditLog.entity == "tv")}

        assert {"create_tv", "update_tv", "tv_disconnect", "tv_regenerate_link"} <= acoes


class TestConexaoDaTv:
    def _conectar(self, client, db_session, tvs, codigo=None):
        secret, row = _segredos(db_session, tvs.tv["id"])
        codigo = codigo or client.get(f"/tvs/{tvs.tv['id']}/code", headers=tvs.admin).json()["code"]
        return client.post(f"/tv-player/{secret}/connect", json={"code": codigo})

    def test_link_e_codigo_certos_dao_o_token_da_tv(self, client, db_session, tvs):
        resp = self._conectar(client, db_session, tvs)

        assert resp.status_code == 200
        assert resp.json()["token"] and resp.json()["name"] == "Recepcao"
        assert resp.json()["expires_at"] is None  # por padrao a TV fica conectada para sempre

    def test_codigo_errado_e_recusado_sem_token(self, client, db_session, tvs):
        resp = self._conectar(client, db_session, tvs, codigo="000000" if tv_core.CODE_DIGITS == 6 else "0")

        assert resp.status_code == 403 and "token" not in resp.json()

    def test_link_que_nao_existe_responde_igual_a_codigo_errado(self, client, tvs):
        resp = client.post("/tv-player/link-que-nao-existe/connect", json={"code": "123456"})

        assert resp.status_code == 403 and resp.json()["detail"] == "Codigo incorreto"

    def test_o_codigo_de_outra_tv_nao_serve(self, client, db_session, tvs):
        outra = client.post("/tvs", json={"name": "Outra"}, headers=tvs.admin).json()
        codigo_da_outra = client.get(f"/tvs/{outra['id']}/code", headers=tvs.admin).json()["code"]

        assert self._conectar(client, db_session, tvs, codigo=codigo_da_outra).status_code == 403

    def test_o_codigo_pode_vir_com_espacos_e_tracos(self, client, db_session, tvs):
        codigo = client.get(f"/tvs/{tvs.tv['id']}/code", headers=tvs.admin).json()["code"]

        assert self._conectar(client, db_session, tvs, codigo=f"{codigo[:3]} - {codigo[3:]}").status_code == 200

    def test_muitas_tentativas_erradas_trancam_a_tv_por_um_tempo(self, client, db_session, tvs):
        for _ in range(tv_core.MAX_FAILURES):
            tv_core.register_failure(tvs.tv["id"])
        try:
            resp = self._conectar(client, db_session, tvs)
            assert resp.status_code == 429
        finally:
            tv_core.clear_failures(tvs.tv["id"])

    def test_tempo_de_conexao_configurado_vira_o_vencimento_do_token(self, client, db_session, tvs):
        client.put(f"/tvs/{tvs.tv['id']}", json={"session_hours": 2}, headers=tvs.admin)

        resp = self._conectar(client, db_session, tvs)

        assert resp.json()["expires_at"] is not None

    def test_a_lista_so_vem_com_o_token_da_tv(self, client, db_session, tvs):
        assert client.get("/tv-player/playlist").status_code == 401
        assert client.get("/tv-player/playlist", headers={"Authorization": "Bearer lixo"}).status_code == 401
        # O token de uma pessoa logada nao serve como token de TV
        assert client.get("/tv-player/playlist", headers=tvs.admin).status_code == 401

        token = self._conectar(client, db_session, tvs).json()["token"]
        resp = client.get("/tv-player/playlist", headers={"Authorization": f"Bearer {token}"})

        assert resp.status_code == 200 and resp.json() == {"name": "Recepcao", "items": [], "refresh_minutes": None}

    def test_desconectar_derruba_o_token_e_a_tv_precisa_do_codigo_de_novo(self, client, db_session, tvs):
        token = self._conectar(client, db_session, tvs).json()["token"]
        cab = {"Authorization": f"Bearer {token}"}
        assert client.get("/tv-player/playlist", headers=cab).status_code == 200

        client.post(f"/tvs/{tvs.tv['id']}/disconnect", headers=tvs.admin)

        assert client.get("/tv-player/playlist", headers=cab).status_code == 401
        novo = self._conectar(client, db_session, tvs).json()["token"]
        assert client.get("/tv-player/playlist", headers={"Authorization": f"Bearer {novo}"}).status_code == 200

    def test_trocar_o_link_tambem_derruba_a_conexao(self, client, db_session, tvs):
        token = self._conectar(client, db_session, tvs).json()["token"]

        client.post(f"/tvs/{tvs.tv['id']}/regenerate-link", headers=tvs.admin)

        assert client.get("/tv-player/playlist", headers={"Authorization": f"Bearer {token}"}).status_code == 401

    def test_excluir_a_tv_derruba_a_conexao(self, client, db_session, tvs):
        token = self._conectar(client, db_session, tvs).json()["token"]

        client.delete(f"/tvs/{tvs.tv['id']}", headers=tvs.admin)

        assert client.get("/tv-player/playlist", headers={"Authorization": f"Bearer {token}"}).status_code == 401

    def test_a_tv_aparece_como_ligada_depois_de_pedir_a_lista(self, client, db_session, tvs):
        assert client.get("/tvs", headers=tvs.admin).json()[0]["online"] is False
        token = self._conectar(client, db_session, tvs).json()["token"]
        client.get("/tv-player/playlist", headers={"Authorization": f"Bearer {token}"})

        assert client.get("/tvs", headers=tvs.admin).json()[0]["online"] is True

    def test_a_lista_da_tv_traz_so_o_que_a_tela_precisa(self, client, db_session, tvs):
        p1, p2 = _pbi()
        itens = [
            {"kind": "report_page", "seconds": 30, "report_id": tvs.rel["id"], "page_name": "P2"},
            {"kind": "youtube", "seconds": 60, "video_url": "https://youtu.be/dQw4w9WgXcQ", "sound": True},
        ]
        with p1, p2:
            client.put(f"/tvs/{tvs.tv['id']}/items", json={"items": itens}, headers=tvs.admin)
        token = self._conectar(client, db_session, tvs).json()["token"]

        lista = client.get("/tv-player/playlist", headers={"Authorization": f"Bearer {token}"}).json()["items"]

        assert [(i["kind"], i["seconds"]) for i in lista] == [("report_page", 30), ("youtube", 60)]
        assert lista[0]["page_name"] == "P2" and lista[0]["report_name"] == "Vendas"
        assert lista[1]["video_id"] == "dQw4w9WgXcQ" and lista[1]["sound"] is True
        assert "link_secret" not in str(lista)

    def test_o_embed_so_serve_item_da_propria_tv_e_sem_seguranca_por_linha(self, client, db_session, tvs):
        p1, p2 = _pbi()
        with p1, p2:
            tv = client.put(
                f"/tvs/{tvs.tv['id']}/items",
                json={"items": [{"kind": "report_page", "seconds": 30, "report_id": tvs.rel["id"], "page_name": "P1"}]},
                headers=tvs.admin,
            ).json()
        item_id = tv["items"][0]["id"]
        token = self._conectar(client, db_session, tvs).json()["token"]
        cab = {"Authorization": f"Bearer {token}"}

        with p1, p2, patch.object(powerbi, "generate_embed_token", return_value={"token": "tk", "expiration": "2099-01-01T00:00:00Z"}):
            resp = client.get(f"/tv-player/items/{item_id}/embed", headers=cab)
        assert resp.status_code == 200 and resp.json()["access_token"] == "tk"

        # Item de outra TV ou que nao existe: 404
        outra = client.post("/tvs", json={"name": "Outra"}, headers=tvs.admin).json()
        assert client.get("/tv-player/items/99999/embed", headers=cab).status_code == 404
        assert outra["id"] != tvs.tv["id"]

        # Com RLS ligado depois, o embed some
        from app.routers import powerbi as embed_router

        embed_router._embed_cache.clear()
        embed_router._report_static_cache.clear()
        r1, r2 = _pbi(rls=True)
        with r1, r2, patch.object(powerbi, "generate_embed_token", return_value={"token": "tk", "expiration": "2099-01-01T00:00:00Z"}):
            resp = client.get(f"/tv-player/items/{item_id}/embed", headers=cab)
        assert resp.status_code == 400 and "RLS" in resp.json()["detail"]


class TestRegrasDoYoutubeEDoCodigo:
    @pytest.mark.parametrize("url,esperado", [("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"), ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5", "dQw4w9WgXcQ"), ("https://evil.com/watch?v=dQw4w9WgXcQ", None), ("ftp://youtu.be/dQw4w9WgXcQ", None), ("https://youtu.be/curto", None)])
    def test_id_do_video(self, url, esperado):
        assert tv_core.youtube_video_id(url) == esperado

    def test_token_de_outro_tipo_nao_vale_como_token_de_tv(self):
        import jwt

        from app.core.config import settings

        falso = jwt.encode({"kind": "usuario", "tv": 1}, settings.jwt_secret, algorithm=settings.jwt_algorithm)

        assert tv_core.read_device_token(falso) is None
        assert tv_core.read_device_token("") is None


class TestMigracaoDoModoTvAntigo:
    def test_relatorio_marcado_como_tv_vira_painel(self, client, cenario, db_session):
        from app.models.report import Report

        relatorio = db_session.query(Report).get(cenario.rel["id"])
        relatorio.display_type = "tv"
        db_session.commit()

        assert tv_core.move_old_tv_reports(db_session) == 1

        assert db_session.query(Report).get(cenario.rel["id"]).display_type == "painel"
        assert tv_core.move_old_tv_reports(db_session) == 0  # idempotente

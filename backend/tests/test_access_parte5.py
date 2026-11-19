"""Permissoes unificadas, parte 5 da troca da regra: o log geral da auditoria (ver e reverter) e o painel de analíticos.

O painel de analíticos já lia as permissões novas desde a parte 4; aqui fica a prova de que ele e o log geral são
independentes. E o "reverter" exige, além de poder reverter, a permissão do que está sendo desfeito."""

import pytest

from app.core.access_catalog import with_implied
from app.models.audit_log import AuditLog
from tests.access_helpers import dar_permissoes_do_grupo, registro_antigo_de_permissoes

PASSWORD = "SenhaForte123"

# (método, caminho, item exigido)
ROTAS = [
    ("get", "/audit", "auditoria.ver"),
    ("get", "/audit/search", "auditoria.ver"),
    ("post", "/audit/1/revert", "auditoria.reverter"),
    ("get", "/audit/options", "analiticos.ver"),
    ("get", "/audit/summary", "analiticos.ver"),
    ("get", "/audit/query", "analiticos.ver"),
    ("get", "/audit/dashboard", "analiticos.ver"),
]
CHAVES = sorted({chave for _, _, chave in ROTAS})


def _entrar(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def cenario(client):
    admin = _entrar(client, "admin@example.com")
    pessoa = _entrar(client, "pessoa@example.com")
    pessoa_id = next(u["id"] for u in client.get("/users/", headers=admin).json() if u["email"] == "pessoa@example.com")
    return {"admin": admin, "pessoa": pessoa, "pessoa_id": pessoa_id}


def _dar(client, c, globais=(), por_colecao=None):
    blocos = [{"workspace_id": None, "permissions": list(globais)}] if globais else []
    for ws, chaves in (por_colecao or {}).items():
        blocos.append({"workspace_id": ws, "permissions": list(chaves)})
    resp = client.put(f"/access/users/{c['pessoa_id']}", json={"blocks": blocos}, headers=c["admin"])
    assert resp.status_code == 200, resp.text


def _chamar(client, c, metodo, caminho, quem="pessoa"):
    return client.request(metodo.upper(), caminho, json={}, headers=c[quem])


class TestSemPermissao:
    @pytest.mark.parametrize("metodo,caminho,chave", ROTAS)
    def test_quem_nao_tem_nada_recebe_403(self, client, cenario, metodo, caminho, chave):
        assert _chamar(client, cenario, metodo, caminho).status_code == 403

    @pytest.mark.parametrize("metodo,caminho,chave", ROTAS)
    def test_administrador_da_plataforma_passa_em_todas(self, client, cenario, metodo, caminho, chave):
        assert _chamar(client, cenario, metodo, caminho, quem="admin").status_code != 403


class TestCadaItemFazSoOQueDiz:
    @pytest.mark.parametrize("chave", CHAVES)
    def test_um_item_libera_so_as_rotas_dele_e_as_do_que_ele_exige(self, client, cenario, chave):
        _dar(client, cenario, globais=[chave])
        liberadas = set(with_implied([chave]))

        for metodo, caminho, exigida in ROTAS:
            status = _chamar(client, cenario, metodo, caminho).status_code
            if exigida in liberadas:
                assert status != 403, (metodo, caminho)
            else:
                assert status == 403, (metodo, caminho, chave)

    def test_log_geral_e_painel_de_analiticos_sao_independentes(self, client, cenario):
        _dar(client, cenario, globais=["auditoria.ver"])
        assert _chamar(client, cenario, "get", "/audit/summary").status_code == 403

        _dar(client, cenario, globais=["analiticos.ver"])
        assert _chamar(client, cenario, "get", "/audit/search").status_code == 403

    def test_criar_editar_e_excluir_visuais_continuam_cobrados_cada_um(self, client, cenario):
        corpo = {"widgets": []}
        _dar(client, cenario, globais=["analiticos.ver"])
        assert client.put("/audit/dashboard", json=corpo, headers=cenario["pessoa"]).status_code == 403
        assert client.delete("/audit/dashboard", headers=cenario["pessoa"]).status_code == 403

        # Restaurar o painel padrão mexe em tudo de uma vez: pede criar, editar e excluir juntos
        _dar(client, cenario, globais=["analiticos.excluir"])
        assert client.delete("/audit/dashboard", headers=cenario["pessoa"]).status_code == 403

        _dar(client, cenario, globais=["analiticos.criar", "analiticos.editar", "analiticos.excluir"])
        assert client.delete("/audit/dashboard", headers=cenario["pessoa"]).status_code != 403


class TestReverterExigeAPermissaoDoQueSeDesfaz:
    def _ultimo_registro(self, db_session, entidade, acao):
        return (
            db_session.query(AuditLog)
            .filter(AuditLog.entity == entidade, AuditLog.action == acao, AuditLog.change.isnot(None))
            .order_by(AuditLog.id.desc())
            .first()
        )

    def test_desfazer_a_edicao_de_uma_colecao(self, client, cenario, db_session):
        ws = client.post("/workspaces/", json={"name": "Vendas"}, headers=cenario["admin"]).json()["id"]
        client.put(f"/workspaces/{ws}", json={"name": "Vendas 2"}, headers=cenario["admin"])
        registro = self._ultimo_registro(db_session, "workspace", "update").id

        # Só poder reverter não basta: falta poder editar aquela coleção
        _dar(client, cenario, globais=["auditoria.reverter"])
        assert client.post(f"/audit/{registro}/revert", json={}, headers=cenario["pessoa"]).status_code == 403

        # Editar uma coleção diferente também não basta
        outra = client.post("/workspaces/", json={"name": "Outra"}, headers=cenario["admin"]).json()["id"]
        _dar(client, cenario, globais=["auditoria.reverter"], por_colecao={outra: ["colecao.editar"]})
        assert client.post(f"/audit/{registro}/revert", json={}, headers=cenario["pessoa"]).status_code == 403

        _dar(client, cenario, globais=["auditoria.reverter"], por_colecao={ws: ["colecao.editar"]})
        resposta = client.post(f"/audit/{registro}/revert", json={}, headers=cenario["pessoa"])
        assert resposta.status_code == 200, resposta.text
        assert client.get(f"/workspaces/{ws}", headers=cenario["admin"]).json()["name"] == "Vendas"

    def test_desfazer_uma_troca_de_permissoes_exige_poder_dar_permissoes(self, client, cenario, db_session):
        grupo = client.post("/groups/", json={"name": "Dados"}, headers=cenario["admin"]).json()["id"]
        dar_permissoes_do_grupo(client, cenario["admin"], grupo, ["ia.usar"])
        registro = registro_antigo_de_permissoes(client, db_session, cenario["admin"], grupo, "Dados", [], ["ia.usar"])

        _dar(client, cenario, globais=["auditoria.reverter"])
        assert client.post(f"/audit/{registro}/revert", json={}, headers=cenario["pessoa"]).status_code == 403

        # Desfazer tira "usar o chat de IA" do grupo: com a trava da parte 6, quem desfaz precisa ter esse item
        _dar(client, cenario, globais=["auditoria.reverter", "permissoes.editar"])
        assert client.post(f"/audit/{registro}/revert", json={}, headers=cenario["pessoa"]).status_code == 403

        _dar(client, cenario, globais=["auditoria.reverter", "permissoes.editar", "ia.usar"])
        resposta = client.post(f"/audit/{registro}/revert", json={}, headers=cenario["pessoa"])
        assert resposta.status_code == 200, resposta.text

    def test_registro_que_nao_pode_ser_revertido_continua_dando_400_para_quem_pode(self, client, cenario, db_session):
        client.post("/workspaces/", json={"name": "Vendas"}, headers=cenario["admin"])
        sem_mudanca = db_session.query(AuditLog).filter(AuditLog.change.is_(None)).first()

        _dar(client, cenario, globais=["auditoria.reverter"])
        assert client.post(f"/audit/{sem_mudanca.id}/revert", json={}, headers=cenario["pessoa"]).status_code == 400

    def test_administrador_da_plataforma_desfaz_qualquer_uma(self, client, cenario, db_session):
        ws = client.post("/workspaces/", json={"name": "Vendas"}, headers=cenario["admin"]).json()["id"]
        client.put(f"/workspaces/{ws}", json={"name": "Vendas 2"}, headers=cenario["admin"])
        registro = self._ultimo_registro(db_session, "workspace", "update").id

        assert client.post(f"/audit/{registro}/revert", json={}, headers=cenario["admin"]).status_code == 200

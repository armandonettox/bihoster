"""Permissoes unificadas, parte 6 da troca da regra: a Administração (membros, grupos, permissões, coleções, conexões do
Power BI e configurações do sistema) passa a ser cobrada item por item, com as defesas contra escalada de privilégio:
só se dá e se tira o que se tem, entrar num grupo é receber as permissões dele, e a conta de administrador é protegida.

Corpo vazio e ids que não existem de propósito: sem permissão a rota responde 403 antes de olhar o resto, e com
permissão responde 404 ou 422."""

import pytest

from app.core.access_catalog import with_implied
from app.models.audit_log import AuditLog
from tests.access_helpers import registro_antigo_de_permissoes

PASSWORD = "SenhaForte123"

# (método, caminho, itens que liberam: basta um deles)
ROTAS = [
    ("get", "/users/", ("membros.ver",)),
    ("get", "/users/pending-invites", ("membros.ver",)),
    ("post", "/users/9999/reset-link", ("membros.senha",)),
    ("delete", "/users/9999", ("membros.remover",)),
    ("post", "/groups/", ("grupos.criar",)),
    ("put", "/groups/9999", ("grupos.editar",)),
    ("delete", "/groups/9999", ("grupos.excluir",)),
    ("get", "/groups/9999/members", ("grupos.ver",)),
    ("post", "/groups/9999/members", ("grupos.participantes", "membros.editar")),
    ("post", "/groups/9999/invite", ("membros.adicionar", "grupos.participantes")),
    ("get", "/groups/9999/invites", ("membros.ver", "grupos.ver")),
    ("delete", "/groups/9999/invites/1", ("membros.convites",)),
    ("delete", "/groups/9999/members/1", ("grupos.participantes", "membros.editar")),
    ("get", "/access/catalog", ("membros.ver", "grupos.ver", "permissoes.editar")),
    ("get", "/access/report", ("membros.ver",)),
    ("post", "/access/by-email", ("membros.adicionar",)),
    ("get", "/access/groups", ("grupos.ver",)),
    ("get", "/access/groups/9999", ("grupos.ver",)),
    ("put", "/access/groups/9999", ("permissoes.editar",)),
    ("get", "/access/users/9999", ("membros.ver",)),
    ("put", "/access/users/9999", ("permissoes.editar",)),
    ("get", "/powerbi-connections/", ("conexao.ver",)),
    ("post", "/powerbi-connections/", ("conexao.criar",)),
    ("put", "/powerbi-connections/9999", ("conexao.editar",)),
    ("delete", "/powerbi-connections/9999", ("conexao.excluir",)),
    ("get", "/settings/cache/stats", ("sistema.cache",)),
    ("delete", "/settings/cache", ("sistema.cache",)),
    ("post", "/settings/logo", ("sistema.marca",)),
    ("delete", "/settings/logo", ("sistema.marca",)),
    ("post", "/settings/favicon", ("sistema.marca",)),
    ("delete", "/settings/favicon", ("sistema.marca",)),
    ("post", "/settings/login-image", ("sistema.marca",)),
    ("delete", "/settings/login-image", ("sistema.marca",)),
    ("get", "/settings/email/", ("sistema.email",)),
    ("put", "/settings/email/", ("sistema.email",)),
    ("post", "/settings/email/test", ("sistema.email",)),
    ("get", "/system/version", ("sistema.versao",)),
    ("get", "/system/version/history", ("sistema.versao",)),
    ("get", "/system/version/logs", ("sistema.versao",)),
]
CHAVES = sorted({chave for _, _, chaves in ROTAS for chave in chaves})


@pytest.fixture(autouse=True)
def _pasta_de_dados_isolada(monkeypatch, tmp_path):
    """A rota dos registros de atualizacao cria a pasta de dados do container (/app/data); fora do Docker, como na CI,
    ela nao pode ser criada. Os testes apontam para uma pasta temporaria, como os testes de atualizacao do sistema."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))


def _entrar(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def cenario(client):
    admin = _entrar(client, "admin@example.com")
    pessoa = _entrar(client, "pessoa@example.com")
    alvo = _entrar(client, "alvo@example.com")
    ids = {u["email"]: u["id"] for u in client.get("/users/", headers=admin).json()}
    return {
        "admin": admin,
        "pessoa": pessoa,
        "alvo": alvo,
        "admin_id": ids["admin@example.com"],
        "pessoa_id": ids["pessoa@example.com"],
        "alvo_id": ids["alvo@example.com"],
    }


def _dar(client, c, globais=(), por_colecao=None, quem="pessoa_id"):
    blocos = [{"workspace_id": None, "permissions": list(globais)}] if globais else []
    for ws, chaves in (por_colecao or {}).items():
        blocos.append({"workspace_id": ws, "permissions": list(chaves)})
    resposta = client.put(f"/access/users/{c[quem]}", json={"blocks": blocos}, headers=c["admin"])
    assert resposta.status_code == 200, resposta.text


def _chamar(client, c, metodo, caminho, quem="pessoa", corpo=None):
    return client.request(metodo.upper(), caminho, json={} if corpo is None else corpo, headers=c[quem])


def _grupo(client, c, nome="Dados"):
    return client.post("/groups/", json={"name": nome}, headers=c["admin"]).json()["id"]


def _id_do_grupo_administradores(client, c):
    return next(g["id"] for g in client.get("/groups/", headers=c["admin"]).json() if g["is_admin_group"])


class TestSemPermissao:
    @pytest.mark.parametrize("metodo,caminho,chaves", ROTAS)
    def test_quem_nao_tem_nada_recebe_403(self, client, cenario, metodo, caminho, chaves):
        assert _chamar(client, cenario, metodo, caminho).status_code == 403

    @pytest.mark.parametrize("metodo,caminho,chaves", ROTAS)
    def test_administrador_da_plataforma_passa_em_todas(self, client, cenario, metodo, caminho, chaves):
        assert _chamar(client, cenario, metodo, caminho, quem="admin").status_code != 403


class TestCadaItemFazSoOQueDiz:
    @pytest.mark.parametrize("chave", CHAVES)
    def test_um_item_libera_so_as_rotas_dele_e_as_do_que_ele_exige(self, client, cenario, chave):
        _dar(client, cenario, globais=[chave])
        liberadas = set(with_implied([chave]))

        for metodo, caminho, chaves in ROTAS:
            status = _chamar(client, cenario, metodo, caminho).status_code
            if liberadas & set(chaves):
                assert status != 403, (metodo, caminho)
            else:
                assert status == 403, (metodo, caminho, chave)

    def test_aplicar_a_atualizacao_do_sistema_so_o_administrador_da_plataforma(self, client, cenario):
        todas = [p for p in with_implied(CHAVES) if p.startswith(("sistema.", "membros.", "grupos.", "permissoes."))]
        _dar(client, cenario, globais=todas)
        assert client.post("/system/version/apply", headers=cenario["pessoa"]).status_code == 403


class TestSoSeDaESeTiraOQueSeTem:
    def test_dar_o_que_tem_pode_e_o_que_nao_tem_nao(self, client, cenario):
        _dar(client, cenario, globais=["permissoes.editar", "ia.usar", "analiticos.ver"])
        destino = f"/access/users/{cenario['alvo_id']}"

        ok = {"blocks": [{"workspace_id": None, "permissions": ["ia.usar"]}]}
        assert _chamar(client, cenario, "put", destino, corpo=ok).status_code == 200

        alem = {"blocks": [{"workspace_id": None, "permissions": ["ia.usar", "ia.chaves"]}]}
        resposta = _chamar(client, cenario, "put", destino, corpo=alem)
        assert resposta.status_code == 403
        assert "Configurar chaves" in resposta.json()["detail"]

    def test_nao_tira_o_que_nao_tem_mas_mantem_o_que_ja_estava(self, client, cenario):
        _dar(client, cenario, globais=["permissoes.editar", "ia.usar"])
        _dar(client, cenario, globais=["ia.consumo"], quem="alvo_id")
        destino = f"/access/users/{cenario['alvo_id']}"

        tirar = {"blocks": []}
        assert _chamar(client, cenario, "put", destino, corpo=tirar).status_code == 403

        # Mandar de volta o que já estava (e acrescentar o que tem) é permitido: o que não muda não conta
        manter = {"blocks": [{"workspace_id": None, "permissions": ["ia.consumo", "ia.usar"]}]}
        assert _chamar(client, cenario, "put", destino, corpo=manter).status_code == 200

    def test_vale_por_colecao_tambem(self, client, cenario):
        a = client.post("/workspaces/", json={"name": "A"}, headers=cenario["admin"]).json()["id"]
        b = client.post("/workspaces/", json={"name": "B"}, headers=cenario["admin"]).json()["id"]
        _dar(client, cenario, globais=["permissoes.editar"], por_colecao={a: ["relatorio.publicar"]})
        destino = f"/access/users/{cenario['alvo_id']}"

        em_a = {"blocks": [{"workspace_id": a, "permissions": ["relatorio.publicar"]}]}
        em_b = {"blocks": [{"workspace_id": b, "permissions": ["relatorio.publicar"]}]}
        assert _chamar(client, cenario, "put", destino, corpo=em_a).status_code == 200
        assert _chamar(client, cenario, "put", destino, corpo=em_b).status_code == 403

    def test_a_pessoa_nao_se_da_mais_do_que_tem(self, client, cenario):
        _dar(client, cenario, globais=["permissoes.editar"])
        proprio = f"/access/users/{cenario['pessoa_id']}"
        corpo = {"blocks": [{"workspace_id": None, "permissions": ["permissoes.editar", "membros.remover"]}]}
        assert _chamar(client, cenario, "put", proprio, corpo=corpo).status_code == 403

    def test_permissoes_de_grupo_pela_tela_nova(self, client, cenario):
        grupo = _grupo(client, cenario)
        _dar(client, cenario, globais=["permissoes.editar", "ia.registro"])
        destino = f"/access/groups/{grupo}"

        ok = {"blocks": [{"workspace_id": None, "permissions": ["ia.registro"]}]}
        alem = {"blocks": [{"workspace_id": None, "permissions": ["ia.registro", "ia.consumo"]}]}
        assert _chamar(client, cenario, "put", destino, corpo=ok).status_code == 200
        assert _chamar(client, cenario, "put", destino, corpo=alem).status_code == 403

    def test_adicionar_membro_com_permissoes_pede_que_quem_adiciona_tenha_elas(self, client, cenario):
        _dar(client, cenario, globais=["membros.adicionar", "ia.usar"])
        pedido = lambda chaves: {  # noqa: E731
            "email": "alvo@example.com",
            "blocks": [{"workspace_id": None, "permissions": chaves}],
        }

        assert _chamar(client, cenario, "post", "/access/by-email", corpo=pedido(["ia.usar"])).status_code == 200
        assert _chamar(client, cenario, "post", "/access/by-email", corpo=pedido(["ia.chaves"])).status_code == 403

    def test_convite_com_permissoes_reservadas_tambem_confere(self, client, cenario):
        grupo = _grupo(client, cenario)
        client.post(f"/groups/{grupo}/invite", json={"email": "novo@example.com"}, headers=cenario["admin"])
        _dar(client, cenario, globais=["membros.adicionar", "ia.usar"])
        pedido = lambda chaves: {  # noqa: E731
            "email": "novo@example.com",
            "blocks": [{"workspace_id": None, "permissions": chaves}],
        }

        assert _chamar(client, cenario, "post", "/access/by-email", corpo=pedido(["ia.chaves"])).status_code == 403
        assert _chamar(client, cenario, "post", "/access/by-email", corpo=pedido(["ia.usar"])).status_code == 200

    def test_desfazer_uma_troca_de_permissoes_tambem_confere(self, client, cenario, db_session):
        grupo = _grupo(client, cenario)
        # Registro antigo: o grupo tinha "gerenciar a IA" e perdeu; desfazer devolve os cinco itens
        registro = registro_antigo_de_permissoes(client, db_session, cenario["admin"], grupo, "Dados", ["ia.gerenciar"], [])

        # Desfazer devolveria os cinco itens da IA ao grupo: quem não tem esses itens não pode
        _dar(client, cenario, globais=["auditoria.reverter", "permissoes.editar"])
        assert client.post(f"/audit/{registro}/revert", json={}, headers=cenario["pessoa"]).status_code == 403

        itens = ["ia.chaves", "ia.modelos", "ia.bloqueios", "ia.registro", "ia.consumo"]
        _dar(client, cenario, globais=["auditoria.reverter", "permissoes.editar", *itens])
        resposta = client.post(f"/audit/{registro}/revert", json={}, headers=cenario["pessoa"])
        assert resposta.status_code == 200, resposta.text


class TestEntrarNumGrupoEReceberAsPermissoesDele:
    def test_so_coloca_num_grupo_cujas_permissoes_tem(self, client, cenario):
        leve = _grupo(client, cenario, "Leve")
        pesado = _grupo(client, cenario, "Pesado")
        client.put(
            f"/access/groups/{leve}",
            json={"blocks": [{"workspace_id": None, "permissions": ["ia.usar"]}]},
            headers=cenario["admin"],
        )
        client.put(
            f"/access/groups/{pesado}",
            json={"blocks": [{"workspace_id": None, "permissions": ["ia.usar", "membros.remover"]}]},
            headers=cenario["admin"],
        )
        _dar(client, cenario, globais=["grupos.participantes", "ia.usar"])
        corpo = {"email": "alvo@example.com"}

        assert _chamar(client, cenario, "post", f"/groups/{leve}/members", corpo=corpo).status_code == 201
        resposta = _chamar(client, cenario, "post", f"/groups/{pesado}/members", corpo=corpo)
        assert resposta.status_code == 403 and "Remover membros" in resposta.json()["detail"]

    def test_o_convite_ao_grupo_tem_a_mesma_trava(self, client, cenario):
        pesado = _grupo(client, cenario, "Pesado")
        client.put(
            f"/access/groups/{pesado}",
            json={"blocks": [{"workspace_id": None, "permissions": ["ia.chaves"]}]},
            headers=cenario["admin"],
        )
        _dar(client, cenario, globais=["membros.adicionar"])

        resposta = _chamar(client, cenario, "post", f"/groups/{pesado}/invite", corpo={"email": "alguem@example.com"})
        assert resposta.status_code == 403

    def test_grupo_administradores_so_o_administrador_da_plataforma_mexe(self, client, cenario):
        administradores = _id_do_grupo_administradores(client, cenario)
        todas = ["grupos.participantes", "membros.editar", "membros.adicionar", "permissoes.editar"]
        _dar(client, cenario, globais=todas)
        corpo = {"email": "alvo@example.com"}

        assert _chamar(client, cenario, "post", f"/groups/{administradores}/members", corpo=corpo).status_code == 403
        assert _chamar(client, cenario, "post", f"/groups/{administradores}/invite", corpo=corpo).status_code == 403
        assert _chamar(client, cenario, "delete", f"/groups/{administradores}/members/{cenario['admin_id']}").status_code == 403
        # O administrador da plataforma continua podendo
        assert _chamar(client, cenario, "post", f"/groups/{administradores}/members", quem="admin", corpo=corpo).status_code == 201

    def test_grupo_sem_permissoes_qualquer_um_com_o_item_coloca(self, client, cenario):
        vazio = _grupo(client, cenario, "Vazio")
        _dar(client, cenario, globais=["grupos.participantes"])
        resposta = _chamar(client, cenario, "post", f"/groups/{vazio}/members", corpo={"email": "alvo@example.com"})
        assert resposta.status_code == 201

    def test_tirar_alguem_de_um_grupo_comum(self, client, cenario):
        grupo = _grupo(client, cenario)
        client.post(f"/groups/{grupo}/members", json={"email": "alvo@example.com"}, headers=cenario["admin"])
        _dar(client, cenario, globais=["membros.editar"])

        assert _chamar(client, cenario, "delete", f"/groups/{grupo}/members/{cenario['alvo_id']}").status_code == 204


class TestContaDeAdministrador:
    def test_gerar_link_de_senha_so_para_quem_nao_e_administrador(self, client, cenario):
        _dar(client, cenario, globais=["membros.senha"])

        assert _chamar(client, cenario, "post", f"/users/{cenario['admin_id']}/reset-link").status_code == 403
        assert _chamar(client, cenario, "post", f"/users/{cenario['alvo_id']}/reset-link").status_code == 200
        # O administrador da plataforma gera para qualquer conta
        assert _chamar(client, cenario, "post", f"/users/{cenario['alvo_id']}/reset-link", quem="admin").status_code == 200

    def test_apagar_conta_de_administrador_so_outro_administrador(self, client, cenario):
        _dar(client, cenario, globais=["membros.remover"])

        assert _chamar(client, cenario, "delete", f"/users/{cenario['admin_id']}").status_code == 403
        assert _chamar(client, cenario, "delete", f"/users/{cenario['alvo_id']}").status_code == 204

    def test_nao_apaga_a_propria_conta(self, client, cenario):
        _dar(client, cenario, globais=["membros.remover"])
        assert _chamar(client, cenario, "delete", f"/users/{cenario['pessoa_id']}").status_code == 400


class TestConfiguracoesCampoACampo:
    def _mudar(self, client, c, corpo):
        return client.put("/settings/", json=corpo, headers=c["pessoa"])

    def test_sem_nenhum_item_de_sistema(self, client, cenario):
        assert self._mudar(client, cenario, {}).status_code == 403
        assert self._mudar(client, cenario, {"primary_color": "#112233"}).status_code == 403

    def test_marca_muda_cores_e_telas_de_erro_e_mais_nada(self, client, cenario):
        _dar(client, cenario, globais=["sistema.marca"])

        assert self._mudar(client, cenario, {"primary_color": "#112233"}).status_code == 200
        assert self._mudar(client, cenario, {"error_title": "Ops"}).status_code == 200
        assert self._mudar(client, cenario, {"timezone": "America/Sao_Paulo"}).status_code == 403
        assert self._mudar(client, cenario, {"allow_registration": True}).status_code == 403
        assert self._mudar(client, cenario, {"cache_warmup_enabled": False}).status_code == 403

    def test_um_pedido_com_um_campo_fora_da_permissao_nao_muda_nenhum(self, client, cenario):
        _dar(client, cenario, globais=["sistema.marca"])
        antes = client.get("/settings/").json()["primary_color"]

        resposta = self._mudar(client, cenario, {"primary_color": "#abcdef", "timezone": "America/Sao_Paulo"})

        assert resposta.status_code == 403 and "timezone" in resposta.json()["detail"]
        assert client.get("/settings/").json()["primary_color"] == antes

    def test_nome_da_empresa_vale_para_geral_ou_marca(self, client, cenario):
        _dar(client, cenario, globais=["sistema.geral"])
        assert self._mudar(client, cenario, {"company_name": "Acme"}).status_code == 200
        _dar(client, cenario, globais=["sistema.marca"])
        assert self._mudar(client, cenario, {"company_name": "Acme 2"}).status_code == 200
        _dar(client, cenario, globais=["sistema.cache"])
        assert self._mudar(client, cenario, {"company_name": "Acme 3"}).status_code == 403

    def test_cada_aba_o_seu_grupo_de_campos(self, client, cenario):
        casos = {
            "sistema.geral": ({"support_email": "ajuda@acme.com"}, {"google_oauth_enabled": True}),
            "sistema.autenticacao": ({"allow_registration": False}, {"support_email": "ajuda@acme.com"}),
            "sistema.cache": ({"cache_warmup_interval_seconds": 120}, {"allow_registration": True}),
        }
        for chave, (permitido, negado) in casos.items():
            _dar(client, cenario, globais=[chave])
            assert self._mudar(client, cenario, permitido).status_code == 200, (chave, permitido)
            assert self._mudar(client, cenario, negado).status_code == 403, (chave, negado)

    def test_administrador_da_plataforma_muda_qualquer_campo(self, client, cenario):
        assert client.put("/settings/", json={"timezone": "America/Sao_Paulo", "allow_registration": True}, headers=cenario["admin"]).status_code == 200

"""Chamadas novas ao Power BI para o chat: a consulta DAX estrita e a leitura das flags de RLS.
Conferem o contrato HTTP de verdade (URL, corpo, cabecalhos) com um transporte falso."""

import json
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pytest

from app.core import powerbi
from app.core.powerbi import DaxQueryError, PowerBIError

CONEXAO = SimpleNamespace(id=1, tenant_id="t", client_id="c", client_secret="s")


@pytest.fixture
def chamadas(monkeypatch):
    """Registra as requisicoes e devolve a resposta que o teste definir em `resposta`."""
    registro = {"requisicoes": [], "resposta": httpx.Response(200, json={})}

    def handler(request: httpx.Request) -> httpx.Response:
        registro["requisicoes"].append(request)
        return registro["resposta"]

    monkeypatch.setattr(powerbi, "_http", httpx.Client(transport=httpx.MockTransport(handler)))
    with patch.object(powerbi, "_get_aad_token", return_value="token-aad"):
        yield registro


def _resultado(rows=None, **extra):
    return httpx.Response(200, json={"results": [{"tables": [{"rows": rows or []}], **extra}]})


class TestExecuteDaxQueryStrict:
    def test_url_corpo_e_cabecalho(self, chamadas):
        chamadas["resposta"] = _resultado([{"Vendas[Total]": 10}])

        rows = powerbi.execute_dax_query_strict(CONEXAO, "ws-1", "ds-1", "EVALUATE Vendas")

        req = chamadas["requisicoes"][0]
        assert str(req.url) == "https://api.powerbi.com/v1.0/myorg/groups/ws-1/datasets/ds-1/executeQueries"
        assert req.headers["authorization"] == "Bearer token-aad"
        corpo = json.loads(req.content)
        assert corpo == {"queries": [{"query": "EVALUATE Vendas"}], "serializerSettings": {"includeNulls": True}}
        assert rows == [{"Vendas[Total]": 10}]

    def test_nunca_manda_identidade_do_usuario(self, chamadas):
        chamadas["resposta"] = _resultado()

        powerbi.execute_dax_query_strict(CONEXAO, "ws", "ds", "EVALUATE x")

        assert "impersonatedUserName" not in json.loads(chamadas["requisicoes"][0].content)

    def test_usa_o_tempo_limite_pedido(self, chamadas):
        chamadas["resposta"] = _resultado()

        powerbi.execute_dax_query_strict(CONEXAO, "ws", "ds", "EVALUATE x", timeout=12.5)

        assert chamadas["requisicoes"][0].extensions["timeout"]["read"] == 12.5

    def test_sem_resultados_devolve_lista_vazia(self, chamadas):
        chamadas["resposta"] = httpx.Response(200, json={"results": []})

        assert powerbi.execute_dax_query_strict(CONEXAO, "ws", "ds", "EVALUATE x") == []

    def test_resultado_sem_tabelas_devolve_lista_vazia(self, chamadas):
        chamadas["resposta"] = httpx.Response(200, json={"results": [{"tables": []}]})

        assert powerbi.execute_dax_query_strict(CONEXAO, "ws", "ds", "EVALUATE x") == []

    def test_400_e_erro_de_dax_corrigivel(self, chamadas):
        chamadas["resposta"] = httpx.Response(400, text="Coluna Vendas[Foo] nao encontrada")

        with pytest.raises(DaxQueryError, match="Foo"):
            powerbi.execute_dax_query_strict(CONEXAO, "ws", "ds", "EVALUATE x")

    @pytest.mark.parametrize("status", [401, 403, 429, 500])
    def test_outros_erros_nao_sao_de_dax(self, chamadas, status):
        chamadas["resposta"] = httpx.Response(status, text="falhou")

        with pytest.raises(PowerBIError) as erro:
            powerbi.execute_dax_query_strict(CONEXAO, "ws", "ds", "EVALUATE x")

        assert not isinstance(erro.value, DaxQueryError)

    def test_erro_dentro_do_resultado_com_status_200_nao_vira_linhas_parciais(self, chamadas):
        chamadas["resposta"] = httpx.Response(
            200,
            json={
                "results": [
                    {
                        "tables": [{"rows": [{"a": 1}]}],
                        "error": {"code": "DatasetExecuteQueriesError", "message": "More than 100000 rows in a query result"},
                    }
                ]
            },
        )

        with pytest.raises(DaxQueryError, match="More than 100000 rows"):
            powerbi.execute_dax_query_strict(CONEXAO, "ws", "ds", "EVALUATE x")

    def test_erro_dentro_da_tabela_tambem_e_erro(self, chamadas):
        chamadas["resposta"] = httpx.Response(
            200, json={"results": [{"tables": [{"rows": [], "error": {"message": "More than one result table in a query"}}]}]}
        )

        with pytest.raises(DaxQueryError, match="More than one result table"):
            powerbi.execute_dax_query_strict(CONEXAO, "ws", "ds", "EVALUATE x")

    def test_a_funcao_antiga_continua_como_era(self, chamadas):
        # Os alertas usam execute_dax_query: nao pode mudar de comportamento
        chamadas["resposta"] = httpx.Response(
            200, json={"results": [{"tables": [{"rows": [{"a": 1}]}], "error": {"message": "x"}}]}
        )

        assert powerbi.execute_dax_query(CONEXAO, "ws", "ds", "EVALUATE x") == [{"a": 1}]


class TestDatasetSecurityInfo:
    def _dataset(self, chamadas, **campos):
        chamadas["resposta"] = httpx.Response(200, json={"id": "ds-1", "name": "Vendas", **campos})
        return powerbi.get_dataset_security_info(CONEXAO, "ws-1", "ds-1")

    def test_url(self, chamadas):
        self._dataset(chamadas, isEffectiveIdentityRequired=False, isEffectiveIdentityRolesRequired=False)

        assert str(chamadas["requisicoes"][0].url) == "https://api.powerbi.com/v1.0/myorg/groups/ws-1/datasets/ds-1"

    def test_sem_rls_quando_os_dois_campos_vem_falsos(self, chamadas):
        info = self._dataset(chamadas, isEffectiveIdentityRequired=False, isEffectiveIdentityRolesRequired=False)

        assert (info.known, info.has_rls) == (True, False)

    def test_exige_identidade_conta_como_rls(self, chamadas):
        info = self._dataset(chamadas, isEffectiveIdentityRequired=True, isEffectiveIdentityRolesRequired=False)

        assert (info.known, info.has_rls, info.requires_identity) == (True, True, True)

    def test_papeis_de_rls_no_arquivo_contam_como_rls(self, chamadas):
        info = self._dataset(chamadas, isEffectiveIdentityRequired=False, isEffectiveIdentityRolesRequired=True)

        assert (info.known, info.has_rls, info.has_rls_roles) == (True, True, True)

    def test_resposta_limitada_de_quem_so_le_nao_permite_afirmar_nada(self, chamadas):
        info = self._dataset(chamadas)  # so id e name

        assert info.known is False

    def test_so_um_dos_campos_tambem_e_desconhecido(self, chamadas):
        info = self._dataset(chamadas, isEffectiveIdentityRequired=False)

        assert info.known is False

    def test_erro_do_power_bi(self, chamadas):
        chamadas["resposta"] = httpx.Response(404, text="nao achei")

        with pytest.raises(PowerBIError):
            powerbi.get_dataset_security_info(CONEXAO, "ws", "ds")

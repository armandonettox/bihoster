"""Precos do OpenRouter: leitura da lista publica, cache, falha sem derrubar o chat e custo por pergunta."""

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.core import ai_pricing, ai_providers
from app.core.ai_providers import AIError

LISTA = {
    "data": [
        {"id": "openai/gpt-4o-mini", "pricing": {"prompt": "0.000001", "completion": "0.000002"}},
        {"id": "anthropic/claude-x", "pricing": {"prompt": "0.000003", "completion": "0.000015"}},
        {"id": "gratis/modelo", "pricing": {"prompt": "0", "completion": "0"}},
        {"id": "openrouter/auto", "pricing": {"prompt": "-1", "completion": "-1"}},
        {"id": "sem/preco"},
        {"id": "preco/ruim", "pricing": {"prompt": "abc", "completion": "0.1"}},
        {"id": "so/entrada", "pricing": {"prompt": "0.1"}},
        {"pricing": {"prompt": "1", "completion": "1"}},
        "lixo",
    ]
}


@pytest.fixture
def rede(monkeypatch):
    """Transporte falso do OpenRouter. `resposta` e o que ele devolve; `pedidos` conta as chamadas."""
    estado = {"pedidos": [], "resposta": httpx.Response(200, json=LISTA)}

    def handler(request: httpx.Request) -> httpx.Response:
        estado["pedidos"].append(request)
        resposta = estado["resposta"]
        if isinstance(resposta, Exception):
            raise resposta
        return resposta

    monkeypatch.setattr(ai_providers, "_http", httpx.Client(transport=httpx.MockTransport(handler)))
    ai_pricing.clear_cache()
    yield estado
    ai_pricing.clear_cache()


class TestLerPrecos:
    def test_le_so_os_modelos_com_preco_valido(self, rede):
        precos = ai_pricing.get_openrouter_prices()

        assert precos == {
            "openai/gpt-4o-mini": (0.000001, 0.000002),
            "anthropic/claude-x": (0.000003, 0.000015),
            "gratis/modelo": (0.0, 0.0),
        }

    def test_chama_o_endereco_publico_sem_chave(self, rede):
        ai_pricing.get_openrouter_prices()

        pedido = rede["pedidos"][0]
        assert str(pedido.url) == "https://openrouter.ai/api/v1/models"
        assert "authorization" not in pedido.headers

    def test_guarda_em_cache(self, rede):
        ai_pricing.get_openrouter_prices()
        ai_pricing.get_openrouter_prices()

        assert len(rede["pedidos"]) == 1

    def test_o_cache_vence_depois_de_seis_horas(self, rede):
        ai_pricing.get_openrouter_prices()
        vencimento, valor = ai_pricing._cache
        ai_pricing._cache = (datetime.now(timezone.utc) - timedelta(seconds=1), valor)

        ai_pricing.get_openrouter_prices()

        assert len(rede["pedidos"]) == 2
        assert ai_pricing._cache[0] - datetime.now(timezone.utc) > timedelta(hours=5)

    @pytest.mark.parametrize(
        "falha",
        [httpx.Response(500, text="erro"), httpx.Response(200, text="<html>"), httpx.ConnectError("fora do ar")],
    )
    def test_falha_devolve_vazio_e_nao_estoura(self, rede, falha):
        rede["resposta"] = falha

        assert ai_pricing.get_openrouter_prices() == {}

    def test_lembra_da_falha_por_um_minuto_para_nao_martelar(self, rede):
        rede["resposta"] = httpx.Response(500, text="erro")
        ai_pricing.get_openrouter_prices()
        ai_pricing.get_openrouter_prices()

        assert len(rede["pedidos"]) == 1
        assert ai_pricing._cache[0] - datetime.now(timezone.utc) <= ai_pricing.FAILURE_TTL

    def test_depois_da_falha_tenta_de_novo_quando_o_minuto_passa(self, rede):
        rede["resposta"] = httpx.Response(500, text="erro")
        ai_pricing.get_openrouter_prices()
        ai_pricing._cache = (datetime.now(timezone.utc) - timedelta(seconds=1), {})
        rede["resposta"] = httpx.Response(200, json=LISTA)

        assert "openai/gpt-4o-mini" in ai_pricing.get_openrouter_prices()

    @pytest.mark.parametrize("corpo", [[], {}, {"data": "x"}, {"data": None}, "texto"])
    def test_lista_com_formato_estranho_vira_vazio(self, rede, corpo):
        rede["resposta"] = httpx.Response(200, json=corpo)

        assert ai_pricing.get_openrouter_prices() == {}


class TestCusto:
    def test_calcula_entrada_mais_saida_em_dolares(self, rede):
        # 1000 x 0,000003 + 500 x 0,000015 = 0,003 + 0,0075
        assert ai_pricing.cost_usd("openrouter", "anthropic/claude-x", 1000, 500) == pytest.approx(0.0105)

    def test_modelo_gratis_custa_zero(self, rede):
        assert ai_pricing.cost_usd("openrouter", "gratis/modelo", 5000, 5000) == 0.0

    def test_sem_tokens_custa_zero(self, rede):
        assert ai_pricing.cost_usd("openrouter", "openai/gpt-4o-mini", 0, 0) == 0.0

    def test_modelo_fora_da_lista_nao_tem_custo(self, rede):
        assert ai_pricing.cost_usd("openrouter", "modelo/inexistente", 100, 100) is None

    def test_modelo_de_preco_variavel_nao_tem_custo(self, rede):
        assert ai_pricing.cost_usd("openrouter", "openrouter/auto", 100, 100) is None

    @pytest.mark.parametrize("provedor", ["openai", "gemini", "anthropic", "nvidia"])
    def test_outros_provedores_nao_tem_custo_e_nem_consultam_a_rede(self, rede, provedor):
        assert ai_pricing.cost_usd(provedor, "qualquer", 1000, 1000) is None
        assert rede["pedidos"] == []

    def test_sem_rede_o_custo_fica_nulo_e_o_chat_segue(self, rede):
        rede["resposta"] = httpx.ConnectError("fora do ar")

        assert ai_pricing.cost_usd("openrouter", "openai/gpt-4o-mini", 100, 100) is None


class TestHttpGetJson:
    def test_devolve_o_json(self, rede):
        assert ai_providers.http_get_json("https://exemplo.test/x") == LISTA

    def test_erro_http_vira_aierror_com_o_codigo(self, rede):
        rede["resposta"] = httpx.Response(503, text="x")

        with pytest.raises(AIError, match="503"):
            ai_providers.http_get_json("https://exemplo.test/x")

    def test_sem_conexao_vira_aierror(self, rede):
        rede["resposta"] = httpx.ConnectError("fora do ar")

        with pytest.raises(AIError, match="conectar"):
            ai_providers.http_get_json("https://exemplo.test/x")

    def test_corpo_que_nao_e_json_vira_aierror(self, rede):
        rede["resposta"] = httpx.Response(200, text="nao e json")

        with pytest.raises(AIError, match="inesperada"):
            ai_providers.http_get_json("https://exemplo.test/x")

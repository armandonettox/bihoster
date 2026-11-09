"""Adaptadores dos provedores de IA. Os testes trocam o cliente HTTP por um transporte falso e
conferem o contrato de verdade: URL, cabecalhos e corpo de cada provedor (nao a funcao inteira
simulada, que esconderia um cabecalho errado)."""

import json

import httpx
import pytest

from app.core import ai_providers
from app.core.ai_providers import AIError

KEY = "chave-secreta-123"
MESSAGES = [
    {"role": "system", "content": "Voce responde sobre dados."},
    {"role": "user", "content": "Qual o total?"},
]


@pytest.fixture
def chamadas(monkeypatch):
    """Registra as chamadas e devolve a resposta que o teste definir em `resposta`."""
    registro = {"requisicoes": [], "resposta": httpx.Response(200, json={})}

    def handler(request: httpx.Request) -> httpx.Response:
        registro["requisicoes"].append(request)
        resposta = registro["resposta"]
        if isinstance(resposta, Exception):
            raise resposta
        return resposta

    monkeypatch.setattr(ai_providers, "_http", httpx.Client(transport=httpx.MockTransport(handler)))
    return registro


def _openai_ok(texto="ok", prompt=11, completion=3):
    return httpx.Response(
        200,
        json={"choices": [{"message": {"content": texto}}], "usage": {"prompt_tokens": prompt, "completion_tokens": completion}},
    )


def _anthropic_ok(texto="ok", entrada=11, saida=3):
    return httpx.Response(
        200,
        json={"content": [{"type": "text", "text": texto}], "usage": {"input_tokens": entrada, "output_tokens": saida}},
    )


class TestFormatoOpenAICompativel:
    @pytest.mark.parametrize(
        "provedor,url",
        [
            ("openai", "https://api.openai.com/v1/chat/completions"),
            ("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"),
            ("openrouter", "https://openrouter.ai/api/v1/chat/completions"),
            ("nvidia", "https://integrate.api.nvidia.com/v1/chat/completions"),
        ],
    )
    def test_url_e_cabecalho_de_cada_provedor(self, chamadas, provedor, url):
        chamadas["resposta"] = _openai_ok()

        ai_providers.complete(provedor, KEY, "modelo-x", MESSAGES, max_tokens=50)

        req = chamadas["requisicoes"][0]
        assert str(req.url) == url
        assert req.headers["authorization"] == f"Bearer {KEY}"
        corpo = json.loads(req.content)
        assert corpo["model"] == "modelo-x"
        assert corpo["messages"] == MESSAGES

    def test_openai_usa_max_completion_tokens(self, chamadas):
        chamadas["resposta"] = _openai_ok()

        ai_providers.complete("openai", KEY, "m", MESSAGES, max_tokens=50)

        corpo = json.loads(chamadas["requisicoes"][0].content)
        assert corpo["max_completion_tokens"] == 50
        assert "max_tokens" not in corpo

    @pytest.mark.parametrize("provedor", ["gemini", "openrouter", "nvidia"])
    def test_os_outros_usam_max_tokens(self, chamadas, provedor):
        chamadas["resposta"] = _openai_ok()

        ai_providers.complete(provedor, KEY, "m", MESSAGES, max_tokens=50)

        corpo = json.loads(chamadas["requisicoes"][0].content)
        assert corpo["max_tokens"] == 50
        assert "max_completion_tokens" not in corpo

    def test_devolve_texto_e_uso_de_tokens(self, chamadas):
        chamadas["resposta"] = _openai_ok("Total: 10", prompt=40, completion=7)

        resultado = ai_providers.complete("openrouter", KEY, "m", MESSAGES)

        assert (resultado.text, resultado.input_tokens, resultado.output_tokens) == ("Total: 10", 40, 7)

    def test_sem_uso_na_resposta_os_tokens_ficam_zerados(self, chamadas):
        chamadas["resposta"] = httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

        resultado = ai_providers.complete("nvidia", KEY, "m", MESSAGES)

        assert (resultado.input_tokens, resultado.output_tokens) == (0, 0)

    def test_conteudo_nulo_vira_texto_vazio(self, chamadas):
        chamadas["resposta"] = httpx.Response(200, json={"choices": [{"message": {"content": None}}]})

        assert ai_providers.complete("openai", KEY, "m", MESSAGES).text == ""

    def test_resposta_sem_choices_e_erro_claro(self, chamadas):
        chamadas["resposta"] = httpx.Response(200, json={"algo": "diferente"})

        with pytest.raises(AIError, match="Resposta inesperada"):
            ai_providers.complete("openai", KEY, "m", MESSAGES)

    def test_resposta_que_nao_e_json_e_erro_claro(self, chamadas):
        chamadas["resposta"] = httpx.Response(200, text="<html>nao sou json</html>")

        with pytest.raises(AIError, match="Resposta inesperada"):
            ai_providers.complete("openai", KEY, "m", MESSAGES)


class TestFormatoAnthropic:
    def test_url_cabecalhos_e_corpo(self, chamadas):
        chamadas["resposta"] = _anthropic_ok()

        ai_providers.complete("anthropic", KEY, "claude-x", MESSAGES, max_tokens=64)

        req = chamadas["requisicoes"][0]
        assert str(req.url) == "https://api.anthropic.com/v1/messages"
        assert req.headers["x-api-key"] == KEY
        assert req.headers["anthropic-version"] == "2023-06-01"
        assert "authorization" not in req.headers
        corpo = json.loads(req.content)
        assert corpo["model"] == "claude-x"
        assert corpo["max_tokens"] == 64

    def test_a_mensagem_de_sistema_vai_em_campo_proprio(self, chamadas):
        chamadas["resposta"] = _anthropic_ok()

        ai_providers.complete("anthropic", KEY, "m", MESSAGES)

        corpo = json.loads(chamadas["requisicoes"][0].content)
        assert corpo["system"] == "Voce responde sobre dados."
        assert corpo["messages"] == [{"role": "user", "content": "Qual o total?"}]

    def test_sem_mensagem_de_sistema_o_campo_nao_vai(self, chamadas):
        chamadas["resposta"] = _anthropic_ok()

        ai_providers.complete("anthropic", KEY, "m", [{"role": "user", "content": "oi"}])

        assert "system" not in json.loads(chamadas["requisicoes"][0].content)

    def test_junta_os_blocos_de_texto_e_le_o_uso(self, chamadas):
        chamadas["resposta"] = httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "Parte 1. "}, {"type": "tool_use"}, {"type": "text", "text": "Parte 2."}],
                "usage": {"input_tokens": 20, "output_tokens": 5},
            },
        )

        resultado = ai_providers.complete("anthropic", KEY, "m", MESSAGES)

        assert (resultado.text, resultado.input_tokens, resultado.output_tokens) == ("Parte 1. Parte 2.", 20, 5)

    def test_resposta_inesperada(self, chamadas):
        chamadas["resposta"] = httpx.Response(200, json={"sem": "content"})

        with pytest.raises(AIError, match="Resposta inesperada"):
            ai_providers.complete("anthropic", KEY, "m", MESSAGES)


class TestErros:
    @pytest.mark.parametrize("status", [401, 403])
    def test_chave_recusada(self, chamadas, status):
        chamadas["resposta"] = httpx.Response(status, json={"error": {"message": "x"}})

        with pytest.raises(AIError, match="recusou a chave"):
            ai_providers.complete("openai", KEY, "m", MESSAGES)

    def test_modelo_nao_encontrado(self, chamadas):
        chamadas["resposta"] = httpx.Response(404, json={})

        with pytest.raises(AIError, match="Modelo nao encontrado"):
            ai_providers.complete("nvidia", KEY, "m", MESSAGES)

    def test_limite_ou_saldo(self, chamadas):
        chamadas["resposta"] = httpx.Response(429, json={})

        with pytest.raises(AIError, match="limite de uso"):
            ai_providers.complete("anthropic", KEY, "m", MESSAGES)

    def test_outro_erro_mostra_o_codigo_e_a_mensagem_do_provedor(self, chamadas):
        chamadas["resposta"] = httpx.Response(400, json={"error": {"message": "Parametro invalido"}})

        with pytest.raises(AIError, match=r"erro 400\. Parametro invalido"):
            ai_providers.complete("openai", KEY, "m", MESSAGES)

    def test_a_chave_repetida_na_mensagem_do_provedor_e_escondida(self, chamadas):
        chamadas["resposta"] = httpx.Response(400, json={"error": {"message": f"Chave {KEY} nao serve"}})

        with pytest.raises(AIError) as erro:
            ai_providers.complete("openai", KEY, "m", MESSAGES)

        assert KEY not in str(erro.value)
        assert "***" in str(erro.value)

    def test_mensagem_do_provedor_e_cortada(self, chamadas):
        chamadas["resposta"] = httpx.Response(400, json={"error": {"message": "a" * 5000}})

        with pytest.raises(AIError) as erro:
            ai_providers.complete("openai", KEY, "m", MESSAGES)

        assert len(str(erro.value)) < 300

    def test_erro_com_corpo_que_nao_e_json(self, chamadas):
        chamadas["resposta"] = httpx.Response(502, text="Bad Gateway")

        with pytest.raises(AIError, match="erro 502"):
            ai_providers.complete("openai", KEY, "m", MESSAGES)

    def test_tempo_esgotado(self, chamadas):
        chamadas["resposta"] = httpx.ReadTimeout("lento")

        with pytest.raises(AIError, match="demorou demais"):
            ai_providers.complete("openai", KEY, "m", MESSAGES)

    def test_sem_conexao(self, chamadas):
        chamadas["resposta"] = httpx.ConnectError(f"falhou com {KEY}")

        with pytest.raises(AIError) as erro:
            ai_providers.complete("openai", KEY, "m", MESSAGES)

        assert "Nao foi possivel conectar" in str(erro.value)
        assert KEY not in str(erro.value)

    def test_provedor_desconhecido(self, chamadas):
        with pytest.raises(AIError, match="desconhecido"):
            ai_providers.complete("inexistente", KEY, "m", MESSAGES)
        assert chamadas["requisicoes"] == []


class TestCatalogo:
    def test_os_cinco_provedores_pedidos_estao_no_catalogo(self):
        assert list(ai_providers.PROVIDERS) == ["openai", "gemini", "anthropic", "openrouter", "nvidia"]

    def test_so_a_anthropic_usa_o_adaptador_proprio(self):
        tipos = {chave: info.kind for chave, info in ai_providers.PROVIDERS.items()}
        assert tipos == {
            "openai": "openai_compat",
            "gemini": "openai_compat",
            "anthropic": "anthropic",
            "openrouter": "openai_compat",
            "nvidia": "openai_compat",
        }

    def test_toda_url_e_https(self):
        assert all(info.base_url.startswith("https://") for info in ai_providers.PROVIDERS.values())

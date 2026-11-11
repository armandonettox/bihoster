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


@pytest.fixture(autouse=True)
def _modelos_simples_limpos():
    ai_providers._plain_models.clear()
    yield
    ai_providers._plain_models.clear()


def _resposta_com_pensamento(texto, finish="stop", pensando=0):
    return httpx.Response(
        200,
        json={
            "choices": [{"message": {"content": texto}, "finish_reason": finish}],
            "usage": {
                "prompt_tokens": 30,
                "completion_tokens": 200,
                "completion_tokens_details": {"reasoning_tokens": pensando},
            },
        },
    )


def _corpo(chamadas, indice=0):
    return json.loads(chamadas["requisicoes"][indice].content)


class TestParametrosExtras:
    def test_openrouter_manda_o_raciocinio_desligado(self, chamadas):
        chamadas["resposta"] = _openai_ok()

        ai_providers.complete("openrouter", KEY, "deepseek/deepseek-v4-pro", MESSAGES)

        assert _corpo(chamadas)["reasoning"] == {"effort": "none"}

    @pytest.mark.parametrize("provedor", ["openai", "gemini", "nvidia"])
    def test_os_outros_provedores_nao_recebem_o_parametro_de_raciocinio(self, chamadas, provedor):
        chamadas["resposta"] = _openai_ok()

        ai_providers.complete(provedor, KEY, "m", MESSAGES)

        assert "reasoning" not in _corpo(chamadas)

    @pytest.mark.parametrize("provedor", ["openai", "gemini", "openrouter", "nvidia"])
    def test_json_mode_pede_resposta_em_json_valido(self, chamadas, provedor):
        chamadas["resposta"] = _openai_ok('{"a": 1}')

        ai_providers.complete(provedor, KEY, "m", MESSAGES, json_mode=True)

        assert _corpo(chamadas)["response_format"] == {"type": "json_object"}

    def test_sem_json_mode_nao_manda_response_format(self, chamadas):
        chamadas["resposta"] = _openai_ok()

        ai_providers.complete("openrouter", KEY, "m", MESSAGES)

        assert "response_format" not in _corpo(chamadas)

    def test_anthropic_ignora_json_mode(self, chamadas):
        chamadas["resposta"] = _anthropic_ok()

        ai_providers.complete("anthropic", KEY, "m", MESSAGES, json_mode=True)

        corpo = _corpo(chamadas)
        assert "response_format" not in corpo and "reasoning" not in corpo

    def test_modelo_que_recusa_os_extras_e_refeito_sem_eles_e_lembrado(self, chamadas):
        respostas = [
            httpx.Response(400, json={"error": {"message": "reasoning nao suportado"}}),
            _openai_ok("ok"),
            _openai_ok("ok de novo"),
        ]
        chamadas["resposta"] = None
        original = ai_providers._http

        def handler(request):
            chamadas["requisicoes"].append(request)
            return respostas.pop(0)

        ai_providers._http = httpx.Client(transport=httpx.MockTransport(handler))
        try:
            primeira = ai_providers.complete("openrouter", KEY, "modelo-x", MESSAGES, json_mode=True)
            segunda = ai_providers.complete("openrouter", KEY, "modelo-x", MESSAGES, json_mode=True)
        finally:
            ai_providers._http = original

        assert (primeira.text, segunda.text) == ("ok", "ok de novo")
        assert "reasoning" in _corpo(chamadas, 0) and "response_format" in _corpo(chamadas, 0)
        assert "reasoning" not in _corpo(chamadas, 1) and "response_format" not in _corpo(chamadas, 1)
        assert "reasoning" not in _corpo(chamadas, 2)  # lembrou: nem tentou os extras de novo
        assert len(chamadas["requisicoes"]) == 3

    def test_erro_422_tambem_refaz_o_pedido_simples(self, chamadas):
        respostas = [httpx.Response(422, json={}), _openai_ok("ok")]
        original = ai_providers._http
        ai_providers._http = httpx.Client(transport=httpx.MockTransport(lambda req: respostas.pop(0)))
        try:
            assert ai_providers.complete("openrouter", KEY, "m", MESSAGES).text == "ok"
        finally:
            ai_providers._http = original

    @pytest.mark.parametrize("status", [401, 403, 404, 429, 500])
    def test_outros_erros_nao_refazem_o_pedido(self, chamadas, status):
        chamadas["resposta"] = httpx.Response(status, json={"error": {"message": "x"}})

        with pytest.raises(AIError) as erro:
            ai_providers.complete("openrouter", KEY, "m", MESSAGES, json_mode=True)

        assert len(chamadas["requisicoes"]) == 1 and erro.value.status == status

    def test_falha_tambem_no_pedido_simples_sobe_o_erro_e_nao_marca_o_modelo(self, chamadas):
        chamadas["resposta"] = httpx.Response(400, json={"error": {"message": "pedido invalido"}})

        with pytest.raises(AIError, match="pedido invalido"):
            ai_providers.complete("openrouter", KEY, "m", MESSAGES, json_mode=True)

        assert len(chamadas["requisicoes"]) == 2 and ("openrouter", "m") not in ai_providers._plain_models

    def test_provedor_sem_extras_nao_refaz_em_400(self, chamadas):
        chamadas["resposta"] = httpx.Response(400, json={"error": {"message": "ruim"}})

        with pytest.raises(AIError):
            ai_providers.complete("openai", KEY, "m", MESSAGES)

        assert len(chamadas["requisicoes"]) == 1


class TestDiagnosticoDaResposta:
    def test_le_o_motivo_da_parada_e_os_tokens_de_raciocinio(self, chamadas):
        chamadas["resposta"] = _resposta_com_pensamento("", finish="length", pensando=200)

        resultado = ai_providers.complete("openrouter", KEY, "m", MESSAGES)

        assert resultado.text == "" and resultado.finish_reason == "length" and resultado.reasoning_tokens == 200

    def test_sem_esses_campos_ficam_vazios_e_zerados(self, chamadas):
        chamadas["resposta"] = _openai_ok()

        resultado = ai_providers.complete("openai", KEY, "m", MESSAGES)

        assert (resultado.finish_reason, resultado.reasoning_tokens) == ("", 0)

    def test_conteudo_em_lista_de_partes_vira_texto(self, chamadas):
        chamadas["resposta"] = httpx.Response(
            200,
            json={"choices": [{"message": {"content": [{"type": "text", "text": "a"}, {"type": "x"}, {"type": "text", "text": "b"}]}}]},
        )

        assert ai_providers.complete("openrouter", KEY, "m", MESSAGES).text == "ab"

    def test_anthropic_devolve_o_stop_reason(self, chamadas):
        chamadas["resposta"] = httpx.Response(
            200, json={"content": [{"type": "text", "text": "oi"}], "stop_reason": "max_tokens", "usage": {}}
        )

        assert ai_providers.complete("anthropic", KEY, "m", MESSAGES).finish_reason == "max_tokens"

    def test_o_erro_leva_o_codigo_http(self, chamadas):
        chamadas["resposta"] = httpx.Response(429, json={})

        with pytest.raises(AIError) as erro:
            ai_providers.complete("openai", KEY, "m", MESSAGES)

        assert erro.value.status == 429


COM_IMAGEM = [
    {"role": "system", "content": "Voce responde sobre dados."},
    {
        "role": "user",
        "content": [
            {"type": "text", "text": "Qual o total?"},
            {"type": "image", "media_type": "image/png", "data": "QUJD"},
        ],
    },
]


class TestImagemNaMensagem:
    @pytest.mark.parametrize("provedor", ["openai", "gemini", "openrouter", "nvidia"])
    def test_openai_compativel_manda_a_imagem_como_data_url(self, chamadas, provedor):
        chamadas["resposta"] = _openai_ok()

        ai_providers.complete(provedor, KEY, "m", COM_IMAGEM)

        mensagens = json.loads(chamadas["requisicoes"][0].content)["messages"]
        assert mensagens[0] == {"role": "system", "content": "Voce responde sobre dados."}
        assert mensagens[1]["content"] == [
            {"type": "text", "text": "Qual o total?"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,QUJD"}},
        ]

    def test_anthropic_manda_a_imagem_como_bloco_base64(self, chamadas):
        chamadas["resposta"] = _anthropic_ok()

        ai_providers.complete("anthropic", KEY, "m", COM_IMAGEM)

        corpo = json.loads(chamadas["requisicoes"][0].content)
        assert corpo["system"] == "Voce responde sobre dados."
        assert corpo["messages"] == [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Qual o total?"},
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "QUJD"}},
                ],
            }
        ]

    def test_mensagem_so_de_texto_segue_igual(self, chamadas):
        chamadas["resposta"] = _openai_ok()

        ai_providers.complete("openai", KEY, "m", MESSAGES)

        assert json.loads(chamadas["requisicoes"][0].content)["messages"] == MESSAGES


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


def _lista(*ids):
    return httpx.Response(200, json={"data": [{"id": i} for i in ids]})


class TestListaDeModelos:
    @pytest.mark.parametrize(
        "provedor,url",
        [
            ("openai", "https://api.openai.com/v1/models"),
            ("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/models"),
            ("openrouter", "https://openrouter.ai/api/v1/models"),
            ("nvidia", "https://integrate.api.nvidia.com/v1/models"),
        ],
    )
    def test_url_e_cabecalho_dos_provedores_openai_compativeis(self, chamadas, provedor, url):
        chamadas["resposta"] = _lista("modelo-b", "modelo-a")

        modelos = ai_providers.list_models(provedor, KEY)

        req = chamadas["requisicoes"][0]
        assert req.method == "GET"
        assert str(req.url) == url
        assert req.headers["authorization"] == f"Bearer {KEY}"
        assert modelos == ["modelo-a", "modelo-b"]

    def test_anthropic_usa_o_cabecalho_proprio_e_pede_a_lista_inteira(self, chamadas):
        chamadas["resposta"] = _lista("claude-b", "claude-a")

        modelos = ai_providers.list_models("anthropic", KEY)

        req = chamadas["requisicoes"][0]
        assert req.url.path == "/v1/models"
        assert req.url.params["limit"] == "1000"
        assert req.headers["x-api-key"] == KEY
        assert req.headers["anthropic-version"] == ai_providers.ANTHROPIC_VERSION
        assert "authorization" not in req.headers
        assert modelos == ["claude-a", "claude-b"]

    def test_gemini_perde_o_prefixo_models(self, chamadas):
        chamadas["resposta"] = _lista("models/gemini-2.0-flash", "models/gemini-1.5-pro")

        assert ai_providers.list_models("gemini", KEY) == ["gemini-1.5-pro", "gemini-2.0-flash"]

    def test_esconde_modelos_que_nao_sao_de_conversa(self, chamadas):
        chamadas["resposta"] = _lista(
            "gpt-4o-mini", "text-embedding-3-small", "whisper-1", "tts-1", "dall-e-3", "gpt-4o-realtime-preview", "gpt-4o"
        )

        assert ai_providers.list_models("openai", KEY) == ["gpt-4o", "gpt-4o-mini"]

    def test_sem_repeticao_e_ignora_itens_malformados(self, chamadas):
        chamadas["resposta"] = httpx.Response(
            200, json={"data": [{"id": "a"}, {"id": "a"}, {"id": 5}, {"nome": "b"}, "c", {"id": ""}]}
        )

        assert ai_providers.list_models("openrouter", KEY) == ["a"]

    def test_lista_sem_nenhum_modelo_de_conversa_e_erro(self, chamadas):
        chamadas["resposta"] = _lista("text-embedding-3-small")

        with pytest.raises(AIError, match="nenhum modelo de conversa"):
            ai_providers.list_models("openai", KEY)

    @pytest.mark.parametrize("corpo", [{}, {"data": "x"}, {"data": None}, []])
    def test_resposta_fora_do_formato(self, chamadas, corpo):
        chamadas["resposta"] = httpx.Response(200, json=corpo)

        with pytest.raises(AIError, match="Resposta inesperada"):
            ai_providers.list_models("openai", KEY)

    def test_resposta_que_nao_e_json(self, chamadas):
        chamadas["resposta"] = httpx.Response(200, text="<html>")

        with pytest.raises(AIError, match="Resposta inesperada"):
            ai_providers.list_models("openai", KEY)

    def test_chave_recusada(self, chamadas):
        chamadas["resposta"] = httpx.Response(401, json={"error": {"message": f"chave {KEY} invalida"}})

        with pytest.raises(AIError, match="recusou a chave") as erro:
            ai_providers.list_models("openai", KEY)
        assert KEY not in str(erro.value)

    def test_404_nao_fala_de_modelo_nao_encontrado(self, chamadas):
        chamadas["resposta"] = httpx.Response(404, json={})

        with pytest.raises(AIError, match="nao oferece a lista") as erro:
            ai_providers.list_models("nvidia", KEY)
        assert "Modelo nao encontrado" not in str(erro.value)

    def test_demora_e_falha_de_conexao(self, chamadas):
        chamadas["resposta"] = httpx.ReadTimeout("lento")
        with pytest.raises(AIError, match="demorou demais"):
            ai_providers.list_models("openai", KEY)

        chamadas["resposta"] = httpx.ConnectError("sem rede")
        with pytest.raises(AIError, match="conectar"):
            ai_providers.list_models("openai", KEY)

    def test_provedor_desconhecido(self):
        with pytest.raises(AIError, match="desconhecido"):
            ai_providers.list_models("nao-existe", KEY)

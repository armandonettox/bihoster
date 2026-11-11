"""Chamada aos provedores de IA. Dois adaptadores cobrem os cinco provedores: o formato
OpenAI-compativel (OpenAI, Gemini, OpenRouter e NVIDIA) e o da Anthropic.

A URL de cada provedor e fixa no codigo, de proposito: sem campo de URL personalizada ninguem
consegue usar o servidor para chamar enderecos internos (SSRF)."""

from dataclasses import dataclass
from typing import Optional

import httpx

ANTHROPIC_VERSION = "2023-06-01"
_MAX_DETAIL_CHARS = 200

_http = httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0))


class AIError(Exception):
    """Falha ao falar com o provedor. A mensagem e segura para mostrar na tela (nunca leva a chave).
    `status` e o codigo HTTP do provedor, quando houve resposta."""

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class ProviderInfo:
    key: str
    label: str
    kind: str  # "openai_compat" ou "anthropic"
    base_url: str
    example_model: str  # so sugestao para o campo; o modelo de verdade e escolhido pelo admin
    max_tokens_field: str = "max_tokens"


# Ordem de exibicao na tela. Modelos aposentam com frequencia, por isso nenhum e fixado no codigo.
PROVIDERS: dict[str, ProviderInfo] = {
    "openai": ProviderInfo(
        key="openai",
        label="OpenAI (ChatGPT)",
        kind="openai_compat",
        base_url="https://api.openai.com/v1",
        example_model="gpt-4o-mini",
        # Os modelos mais novos da OpenAI recusam max_tokens e exigem este campo
        max_tokens_field="max_completion_tokens",
    ),
    "gemini": ProviderInfo(
        key="gemini",
        label="Google Gemini",
        kind="openai_compat",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        example_model="gemini-2.0-flash",
    ),
    "anthropic": ProviderInfo(
        key="anthropic",
        label="Anthropic (Claude)",
        kind="anthropic",
        base_url="https://api.anthropic.com/v1",
        example_model="claude-haiku-5-5",
    ),
    "openrouter": ProviderInfo(
        key="openrouter",
        label="OpenRouter",
        kind="openai_compat",
        base_url="https://openrouter.ai/api/v1",
        example_model="openai/gpt-4o-mini",
    ),
    "nvidia": ProviderInfo(
        key="nvidia",
        label="NVIDIA",
        kind="openai_compat",
        base_url="https://integrate.api.nvidia.com/v1",
        example_model="meta/llama-3.1-70b-instruct",
    ),
}


@dataclass(frozen=True)
class AIResult:
    text: str
    input_tokens: int
    output_tokens: int
    # Por que o modelo parou ("stop", "length" quando o limite de resposta acabou...) e quantos tokens foram
    # gastos pensando. Servem para entender uma resposta vazia: modelo que raciocina gasta o limite pensando.
    finish_reason: str = ""
    reasoning_tokens: int = 0


def http_get_json(url: str, timeout: float = 10.0):
    """GET simples que devolve o JSON ou levanta AIError. Usado para consultas publicas aos provedores
    (hoje, a lista de modelos e precos do OpenRouter, que nao pede chave)."""
    try:
        response = _http.get(url, timeout=timeout)
        if response.status_code != 200:
            raise AIError(f"O provedor respondeu com erro {response.status_code}.")
        return response.json()
    except httpx.HTTPError:
        raise AIError("Nao foi possivel conectar ao provedor.")
    except ValueError:
        raise AIError("Resposta inesperada do provedor.")


def get_provider_info(provider: str) -> ProviderInfo:
    info = PROVIDERS.get(provider)
    if info is None:
        raise AIError("Provedor de IA desconhecido.")
    return info


def _safe_detail(response: httpx.Response, api_key: str) -> str:
    """Mensagem do provedor para mostrar na tela: sem a chave (alguns provedores repetem um pedaco
    dela no erro) e curta."""
    try:
        data = response.json()
    except ValueError:
        return ""
    error = data.get("error") if isinstance(data, dict) else None
    if isinstance(error, dict):
        detail = error.get("message")
    else:
        detail = error if isinstance(error, str) else None
    if not isinstance(detail, str):
        return ""
    detail = detail.replace(api_key, "***")
    return detail[:_MAX_DETAIL_CHARS]


def _raise_for_status(response: httpx.Response, api_key: str) -> None:
    if response.status_code < 400:
        return
    status = response.status_code
    if status in (401, 403):
        raise AIError("O provedor recusou a chave de API. Confira se ela esta correta e ativa.", status)
    if status == 404:
        raise AIError("Modelo nao encontrado nesse provedor. Confira o nome do modelo.", status)
    if status == 429:
        raise AIError("O provedor recusou por limite de uso ou falta de saldo.", status)
    detail = _safe_detail(response, api_key)
    message = f"O provedor respondeu com erro {status}."
    raise AIError(f"{message} {detail}".strip(), status)


def _int(value) -> int:
    return value if isinstance(value, int) and value >= 0 else 0


def _openai_content(content):
    """Texto passa como esta. Lista de partes vira o formato do OpenAI: texto e imagem em data URL."""
    if isinstance(content, str):
        return content
    parts = []
    for part in content:
        if part.get("type") == "image":
            url = f"data:{part['media_type']};base64,{part['data']}"
            parts.append({"type": "image_url", "image_url": {"url": url}})
        else:
            parts.append({"type": "text", "text": part["text"]})
    return parts


def _anthropic_content(content):
    """Texto passa como esta. Lista de partes vira blocos de texto e de imagem da Anthropic."""
    if isinstance(content, str):
        return content
    blocks = []
    for part in content:
        if part.get("type") == "image":
            blocks.append(
                {"type": "image", "source": {"type": "base64", "media_type": part["media_type"], "data": part["data"]}}
            )
        else:
            blocks.append({"type": "text", "text": part["text"]})
    return blocks


# (provedor, modelo) que recusaram os parametros extras abaixo: dali em diante vai o pedido simples, sem insistir
_plain_models: set[tuple[str, str]] = set()


def _extra_params(info: ProviderInfo, model: str, json_mode: bool) -> dict:
    """Parametros alem do basico. Pedem resposta em JSON valido (passos do chat que exigem JSON) e, no
    OpenRouter, raciocinio desligado: modelos que raciocinam (DeepSeek, por exemplo) gastam o limite de resposta
    pensando e devolvem texto vazio, alem de demorar. Se o modelo recusar algum, o pedido e refeito sem eles."""
    if (info.key, model) in _plain_models:
        return {}
    extra: dict = {}
    if json_mode:
        extra["response_format"] = {"type": "json_object"}
    if info.key == "openrouter":
        extra["reasoning"] = {"effort": "none"}
    return extra


def _openai_text(content) -> str:
    """O conteudo vem como texto; alguns provedores mandam uma lista de partes."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text")
    return ""


def _post_openai(info: ProviderInfo, api_key: str, model: str, converted: list[dict], max_tokens: int, extra: dict) -> AIResult:
    body = {"model": model, "messages": converted, info.max_tokens_field: max_tokens, **extra}
    response = _http.post(
        f"{info.base_url}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=body,
    )
    _raise_for_status(response, api_key)
    try:
        data = response.json()
        choice = data["choices"][0]
        text = _openai_text(choice["message"].get("content"))
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        raise AIError("Resposta inesperada do provedor.")
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    details = usage.get("completion_tokens_details") if isinstance(usage.get("completion_tokens_details"), dict) else {}
    finish = choice.get("finish_reason")
    return AIResult(
        text=text,
        input_tokens=_int(usage.get("prompt_tokens")),
        output_tokens=_int(usage.get("completion_tokens")),
        finish_reason=finish if isinstance(finish, str) else "",
        reasoning_tokens=_int(details.get("reasoning_tokens")),
    )


def _complete_openai_compat(
    info: ProviderInfo, api_key: str, model: str, messages: list[dict], max_tokens: int, json_mode: bool = False
) -> AIResult:
    converted = [{"role": m["role"], "content": _openai_content(m["content"])} for m in messages]
    extra = _extra_params(info, model, json_mode)
    try:
        return _post_openai(info, api_key, model, converted, max_tokens, extra)
    except AIError as exc:
        # 400 e 422: o modelo ou o provedor nao aceita um dos parametros extras. Refaz o pedido simples e,
        # se ele funcionar, lembra disso para esse modelo.
        if not extra or exc.status not in (400, 422):
            raise
    result = _post_openai(info, api_key, model, converted, max_tokens, {})
    _plain_models.add((info.key, model))
    return result


def _complete_anthropic(
    info: ProviderInfo, api_key: str, model: str, messages: list[dict], max_tokens: int, json_mode: bool = False
) -> AIResult:
    # A Anthropic nao aceita papel "system" dentro das mensagens: o texto vai num campo proprio
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    chat = [{"role": m["role"], "content": _anthropic_content(m["content"])} for m in messages if m["role"] != "system"]
    body: dict = {"model": model, "max_tokens": max_tokens, "messages": chat}
    if system:
        body["system"] = system
    response = _http.post(
        f"{info.base_url}/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "Content-Type": "application/json",
        },
        json=body,
    )
    _raise_for_status(response, api_key)
    try:
        data = response.json()
        text = "".join(block.get("text", "") for block in data["content"] if block.get("type") == "text")
    except (ValueError, KeyError, TypeError, AttributeError):
        raise AIError("Resposta inesperada do provedor.")
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    stop = data.get("stop_reason")
    return AIResult(
        text=text,
        input_tokens=_int(usage.get("input_tokens")),
        output_tokens=_int(usage.get("output_tokens")),
        finish_reason=stop if isinstance(stop, str) else "",
    )


# Nomes que marcam modelo que nao serve para conversa (vetores, voz, imagem). Os provedores misturam
# tudo na mesma lista; o campo de texto livre na tela cobre qualquer modelo que o filtro esconder.
_NON_CHAT_WORDS = (
    "embedding",
    "embed",
    "whisper",
    "tts",
    "transcribe",
    "dall-e",
    "imagen",
    "moderation",
    "realtime",
    "audio",
    "aqa",
    "rerank",
)
_MAX_MODELS = 1000


def _is_chat_model(model_id: str) -> bool:
    lowered = model_id.lower()
    return not any(word in lowered for word in _NON_CHAT_WORDS)


def list_models(provider: str, api_key: str) -> list[str]:
    """Pergunta ao provedor quais modelos a chave consegue usar, para a tela oferecer uma lista em vez
    de pedir para digitar o nome. Devolve so modelos de conversa, em ordem alfabetica. Qualquer falha
    vira AIError com mensagem segura (sem a chave)."""
    info = get_provider_info(provider)
    try:
        if info.kind == "anthropic":
            response = _http.get(
                f"{info.base_url}/models",
                params={"limit": _MAX_MODELS},
                headers={"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION},
            )
        else:
            response = _http.get(f"{info.base_url}/models", headers={"Authorization": f"Bearer {api_key}"})
    except httpx.TimeoutException:
        raise AIError("O provedor demorou demais para responder.")
    except httpx.HTTPError:
        raise AIError("Nao foi possivel conectar ao provedor.")

    if response.status_code == 404:
        # O 404 de _raise_for_status fala de "modelo nao encontrado", que aqui confundiria
        raise AIError("Esse provedor nao oferece a lista de modelos.")
    _raise_for_status(response, api_key)

    try:
        items = response.json()["data"]
        if not isinstance(items, list):
            raise ValueError("data nao e uma lista")
        ids = {item["id"] for item in items if isinstance(item, dict) and isinstance(item.get("id"), str)}
    except (ValueError, KeyError, TypeError):
        raise AIError("Resposta inesperada do provedor.")

    # O Gemini devolve "models/gemini-..."; o nome usado na conversa e sem o prefixo
    names = {name.removeprefix("models/") for name in ids}
    models = sorted(name for name in names if name and _is_chat_model(name))[:_MAX_MODELS]
    if not models:
        raise AIError("O provedor nao devolveu nenhum modelo de conversa.")
    return models


def complete(
    provider: str,
    api_key: str,
    model: str,
    messages: list[dict],
    max_tokens: int = 1024,
    json_mode: bool = False,
) -> AIResult:
    """Envia as mensagens ([{"role": "system"|"user"|"assistant", "content": "..."}]) ao provedor e
    devolve o texto e o uso de tokens. `json_mode` pede resposta em JSON valido, nos provedores que sabem
    (a Anthropic nao tem esse modo e ignora). Qualquer falha vira AIError com mensagem segura."""
    info = get_provider_info(provider)
    adapter = _complete_anthropic if info.kind == "anthropic" else _complete_openai_compat
    try:
        return adapter(info, api_key, model, messages, max_tokens, json_mode)
    except httpx.TimeoutException:
        raise AIError("O provedor demorou demais para responder.")
    except httpx.HTTPError:
        raise AIError("Nao foi possivel conectar ao provedor.")

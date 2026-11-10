"""Preco por modelo do OpenRouter, para calcular o custo de cada pergunta e controlar o orcamento
mensal. So o OpenRouter tem endpoint publico de precos; para os outros provedores o custo nao e
calculado (ficam so com o limite de perguntas por dia)."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core import ai_providers
from app.core.ai_providers import AIError

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
PRICES_TTL = timedelta(hours=6)
FAILURE_TTL = timedelta(seconds=60)  # nao martela o OpenRouter se ele estiver fora do ar

# (vence_em, {id_do_modelo: (preco_por_token_de_entrada, preco_por_token_de_saida)}) em dolares
_cache: Optional[tuple[datetime, dict[str, tuple[float, float]]]] = None


def clear_cache() -> None:
    global _cache
    _cache = None


def _price(value) -> Optional[float]:
    """Preco por token vem como texto (ex: "0.000003"). Negativo (-1) e o preco variavel de
    modelos roteadores, que nao da para calcular."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _parse_prices(payload) -> dict[str, tuple[float, float]]:
    prices: dict[str, tuple[float, float]] = {}
    models = payload.get("data") if isinstance(payload, dict) else None
    for model in models if isinstance(models, list) else []:
        if not isinstance(model, dict) or not isinstance(model.get("id"), str):
            continue
        pricing = model.get("pricing")
        if not isinstance(pricing, dict):
            continue
        prompt, completion = _price(pricing.get("prompt")), _price(pricing.get("completion"))
        if prompt is not None and completion is not None:
            prices[model["id"]] = (prompt, completion)
    return prices


def get_openrouter_prices() -> dict[str, tuple[float, float]]:
    """Precos dos modelos do OpenRouter, com cache de PRICES_TTL. Falha ao buscar devolve vazio
    (e lembra da falha por um minuto): o chat nunca para por causa do preco."""
    global _cache
    now = datetime.now(timezone.utc)
    if _cache is not None and _cache[0] > now:
        return _cache[1]
    try:
        prices = _parse_prices(ai_providers.http_get_json(OPENROUTER_MODELS_URL))
    except AIError:
        _cache = (now + FAILURE_TTL, {})
        return {}
    _cache = (now + PRICES_TTL, prices)
    return prices


def cost_usd(provider: str, model: str, input_tokens: int, output_tokens: int) -> Optional[float]:
    """Custo da pergunta em dolares, ou None quando nao da para saber (provedor sem tabela de precos
    ou modelo fora da lista do OpenRouter)."""
    if provider != "openrouter":
        return None
    price = get_openrouter_prices().get(model)
    if price is None:
        return None
    return round(input_tokens * price[0] + output_tokens * price[1], 8)

"""Ranking da busca global: decide quais nomes casam com o texto digitado e em que ordem aparecem.

Ignora maiusculas e acentos ("Coleção" casa com "colecao") e trata pontuacao como espaco
("vendas-2024" casa com "vendas 2024"). A busca e literal: nenhum caractere do texto digitado
vira padrao de regex ou de SQL.
"""

import re
import unicodedata

# Quanto menor, melhor. Cada faixa e uma forma de o nome casar com o texto digitado.
TIER_EXACT = 0  # nome igual ao texto
TIER_PREFIX = 1  # nome comeca com o texto
TIER_WORD_START = 2  # alguma palavra do nome comeca com o texto
TIER_CONTAINS = 3  # o texto aparece no meio de uma palavra
TIER_ALL_WORDS = 4  # varias palavras digitadas, todas presentes, em qualquer ordem

_NON_WORD = re.compile(r"[\W_]+")


def normalize_text(value: str) -> str:
    """Minusculas, sem acento, pontuacao virando espaco e espacos colapsados."""
    decomposed = unicodedata.normalize("NFKD", value)
    without_marks = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return _NON_WORD.sub(" ", without_marks.casefold()).strip()


def match_tier(name: str, query: str) -> int | None:
    """Faixa em que `name` casa com `query`, ou None se nao casa. Os dois entram sem normalizar."""
    normalized_name = normalize_text(name)
    normalized_query = normalize_text(query)
    if not normalized_query or not normalized_name:
        return None

    if normalized_name == normalized_query:
        return TIER_EXACT
    if normalized_name.startswith(normalized_query):
        return TIER_PREFIX
    # O espaco antes de cada lado garante que o texto comece numa palavra, nao no meio dela
    if f" {normalized_query}" in f" {normalized_name}":
        return TIER_WORD_START
    if normalized_query in normalized_name:
        return TIER_CONTAINS

    words = normalized_query.split(" ")
    if len(words) > 1 and all(word in normalized_name for word in words):
        return TIER_ALL_WORDS
    return None


def sort_key(tier: int, kind_order: int, name: str, entry_id: int) -> tuple:
    """Ordem final: faixa, depois colecao antes de relatorio, nome mais curto, alfabetica, id."""
    normalized_name = normalize_text(name)
    return (tier, kind_order, len(normalized_name), normalized_name, entry_id)

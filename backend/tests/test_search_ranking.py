"""Testes do ranking da busca: normalizacao de texto e as faixas de relevancia."""

import pytest

from app.core.search_ranking import (
    TIER_ALL_WORDS,
    TIER_CONTAINS,
    TIER_EXACT,
    TIER_PREFIX,
    TIER_WORD_START,
    match_tier,
    normalize_text,
    sort_key,
)


def test_normalize_ignora_acento_maiuscula_e_pontuacao():
    assert normalize_text("Coleção  DE  Vendas-2024") == "colecao de vendas 2024"


def test_normalize_texto_so_com_pontuacao_vira_vazio():
    assert normalize_text(" -- ") == ""


@pytest.mark.parametrize(
    "name, query, expected",
    [
        ("Vendas", "vendas", TIER_EXACT),
        ("Vendas", "VENDAS", TIER_EXACT),
        ("Coleção", "colecao", TIER_EXACT),
        ("Vendas por regiao", "vendas", TIER_PREFIX),
        ("Relatorio de vendas", "vendas", TIER_WORD_START),
        ("Relatorio de vendas", "rel", TIER_PREFIX),
        ("Relatorio de vendas", "ven", TIER_WORD_START),
        ("Relatorio de vendas", "ndas", TIER_CONTAINS),
        ("Vendas 2024 Norte", "norte vendas", TIER_ALL_WORDS),
        ("Vendas 2024 Norte", "vendas norte", TIER_ALL_WORDS),
    ],
)
def test_faixas_de_relevancia(name, query, expected):
    assert match_tier(name, query) == expected


@pytest.mark.parametrize(
    "name, query",
    [
        ("Vendas", "estoque"),
        ("Vendas 2024", "vendas estoque"),
        ("Vendas", ""),
        ("Vendas", "   "),
        ("", "vendas"),
    ],
)
def test_nao_casa(name, query):
    assert match_tier(name, query) is None


def test_busca_e_literal_caracteres_de_regex_nao_sao_padrao():
    # ".*" e "(" nao podem virar curinga nem quebrar nada
    assert match_tier("Vendas", ".*") is None
    # Pontuacao vira espaco dos dois lados: "(2024)" e "2024", que comeca uma palavra do nome
    assert match_tier("Vendas (2024)", "(2024)") == TIER_WORD_START
    assert match_tier("Vendas", "(") is None


def test_palavra_no_meio_nao_conta_como_inicio_de_palavra():
    # "end" aparece dentro de "vendas": e "contem", nao "comeca uma palavra"
    assert match_tier("Vendas", "end") == TIER_CONTAINS


def test_ordem_final_faixa_depois_colecao_depois_nome_curto():
    rows = [
        (sort_key(TIER_PREFIX, 1, "Vendas por regiao", 1), "relatorio longo"),
        (sort_key(TIER_PREFIX, 1, "Vendas", 2), "relatorio curto"),
        (sort_key(TIER_PREFIX, 0, "Vendas por regiao", 3), "colecao"),
        (sort_key(TIER_EXACT, 1, "Vendas por regiao", 4), "exato"),
    ]
    ordered = [label for _, label in sorted(rows)]
    assert ordered == ["exato", "colecao", "relatorio curto", "relatorio longo"]

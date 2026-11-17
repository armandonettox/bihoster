"""Sugestao de colunas para o admin bloquear no chat de IA.

So sinaliza: nada e bloqueado sozinho. O admin ve a marca na tela do relatorio e confirma ou ignora.
Usa so o nome da coluna e a quantidade de valores diferentes, nunca os valores."""

import re
import unicodedata
from typing import Optional

from app.core.chat_dataset import MAX_ROWS_FOR_AI, SchemaColumn

SUGGEST_NAME = "name"  # o nome da coluna lembra dado de pessoa ou documento
SUGGEST_MANY_VALUES = "many_values"  # texto com valores demais para ser uma categoria (nomes, codigos)

# Palavras (sem acento, minusculas) que costumam indicar dado de pessoa ou documento
SENSITIVE_WORDS = frozenset(
    {
        "nome",
        "cpf",
        "cnpj",
        "rg",
        "email",
        "mail",
        "telefone",
        "fone",
        "celular",
        "endereco",
        "nascimento",
        "matricula",
        "carteirinha",
        "beneficiario",
        "paciente",
        "segurado",
        "titular",
        "dependente",
        "cliente",
    }
)

# Mais valores diferentes que isso, numa coluna de texto, e mais parecido com nomes ou codigos que com categoria.
# Mesmo limite de linhas que o chat recebe de volta: agrupar por uma coluna assim ja estoura o resultado.
MANY_VALUES_LIMIT = MAX_ROWS_FOR_AI


def _words(name: str) -> set[str]:
    """Palavras do nome da coluna: separa por sublinhado, espaco, ponto e maiuscula no meio (NomeCliente), tira
    acento e plural simples."""
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name)
    plain = unicodedata.normalize("NFKD", spaced).encode("ascii", "ignore").decode("ascii").lower()
    words = set()
    for word in re.split(r"[^a-z0-9]+", plain):
        if word:
            words.add(word)
            if word.endswith("s") and len(word) > 3:
                words.add(word[:-1])
    return words


def suggestion(column: SchemaColumn) -> Optional[str]:
    """Por que vale considerar bloquear a coluna (SUGGEST_NAME ou SUGGEST_MANY_VALUES), ou None se nada indica."""
    if _words(column.name) & SENSITIVE_WORDS:
        return SUGGEST_NAME
    is_text = column.data_type in (None, "texto")  # sem tipo vem da leitura alternativa do esquema: so texto tem contagem
    if is_text and column.distinct is not None and column.distinct > MANY_VALUES_LIMIT:
        return SUGGEST_MANY_VALUES
    return None

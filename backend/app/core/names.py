"""Padroniza o nome de pessoa: cada nome com a primeira letra maiuscula."""

# Ligacoes de nomes em portugues ficam em minuscula (Maria da Silva, Joao de Souza)
_LOWER_PARTICLES = {"da", "das", "de", "do", "dos", "e"}


def format_person_name(value: str) -> str:
    words = value.split()
    result = []
    for index, word in enumerate(words):
        lower = word.lower()
        if index > 0 and lower in _LOWER_PARTICLES:
            result.append(lower)
        else:
            # Respeita hifen e apostrofo: ana-maria -> Ana-Maria, d'avila -> D'Avila
            result.append(_capitalize_parts(lower))
    return " ".join(result)


def _capitalize_parts(word: str) -> str:
    out = []
    capitalize_next = True
    for char in word:
        out.append(char.upper() if capitalize_next else char)
        capitalize_next = char in "-'"
    return "".join(out)

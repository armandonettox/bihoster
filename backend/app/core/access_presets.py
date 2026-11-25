"""Presets em linguagem simples para dar acesso a um relatorio ou a um modelo: Ver; Ver e exportar (ou atualizar); Gerenciar.
Eles so preenchem as caixas: o que fica guardado e a lista de itens, e "Personalizar" mexe item por item."""

PRESETS: dict[str, dict[str, tuple[str, ...]]] = {
    "report": {
        "ver": ("relatorio.ver",),
        "exportar": ("relatorio.ver", "relatorio.exportar"),
        "gerenciar": (
            "relatorio.ver",
            "relatorio.compartilhar",
            "relatorio.exportar",
            "relatorio.editar",
            "relatorio.miniatura",
            "powerbi.atualizar",
        ),
    },
    "dataset": {
        "ver": ("modelo.ver",),
        "atualizar": ("modelo.ver", "modelo.atualizar", "modelo.historico"),
        "gerenciar": ("modelo.ver", "modelo.atualizar", "modelo.historico", "modelo.seguranca", "modelo.compartilhar"),
    },
}

LABELS: dict[str, dict[str, str]] = {
    "report": {"ver": "Ver", "exportar": "Ver e exportar", "gerenciar": "Gerenciar"},
    "dataset": {"ver": "Ver", "atualizar": "Ver e atualizar", "gerenciar": "Gerenciar"},
}


def preset_of(kind: str, keys: set[str]) -> str | None:
    """O nome do preset que resume exatamente estas permissoes, "personalizado" se nenhum, None se nao ha nenhuma."""
    if not keys:
        return None
    for name, preset_keys in PRESETS[kind].items():
        if set(preset_keys) == keys:
            return name
    return "personalizado"

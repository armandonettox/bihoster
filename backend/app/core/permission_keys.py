"""Chaves de permissao que os grupos podem receber (tabela group_permissions).

Hoje sao as de IA (core/ai_access.py) e as dos analiticos da auditoria. O catalogo de niveis por
pessoa de core/permissions.py nao entra aqui: o acesso do projeto e decidido pelos grupos."""

from app.core.ai_access import AI_PERMISSIONS

ANALYTICS_VIEW = "analiticos.ver"
ANALYTICS_CREATE = "analiticos.criar"
ANALYTICS_EDIT = "analiticos.editar"
ANALYTICS_DELETE = "analiticos.excluir"
ANALYTICS_PERMISSIONS: tuple[str, ...] = (ANALYTICS_VIEW, ANALYTICS_CREATE, ANALYTICS_EDIT, ANALYTICS_DELETE)

# Criar, editar e excluir visuais pressupoem poder ver o painel
_ANALYTICS_CHANGES = (ANALYTICS_CREATE, ANALYTICS_EDIT, ANALYTICS_DELETE)

# Tudo que a tela de permissoes do grupo edita
MANAGED_PERMISSIONS: tuple[str, ...] = AI_PERMISSIONS + ANALYTICS_PERMISSIONS


def with_implied(keys: set[str] | list[str]) -> list[str]:
    """Sem repetidos e em ordem; quem pode criar, editar ou excluir analiticos tambem pode ver."""
    result = set(keys)
    if result.intersection(_ANALYTICS_CHANGES):
        result.add(ANALYTICS_VIEW)
    return sorted(result)

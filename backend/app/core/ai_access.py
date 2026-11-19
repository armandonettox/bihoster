"""O que a pessoa pode fazer com a IA, no formato que a tela conhece: gerenciar (qualquer um dos itens de gerência)
e usar o chat.

A permissão vem das permissões novas (tabela access_grants): a soma do que vem dos grupos da pessoa com o que foi dado a
ela, e quem é do grupo Administradores tem todas. As rotas de IA cobram cada item do catálogo direto, com
`require_global_permission`; este módulo só resume para a rota /ai/access."""

from sqlalchemy.orm import Session

AI_MANAGE = "ia.gerenciar"
AI_USE = "ia.usar"
AI_PERMISSIONS: tuple[str, ...] = (AI_MANAGE, AI_USE)

# Os itens que, juntos, eram o "gerenciar a IA" antigo; ter qualquer um já mostra a área de configuração na tela
AI_MANAGE_ITEMS: tuple[str, ...] = ("ia.chaves", "ia.modelos", "ia.bloqueios", "ia.registro", "ia.consumo")
AI_ITEM_KEYS: tuple[str, ...] = (AI_USE, *AI_MANAGE_ITEMS)


def ai_item_keys(db: Session, user_id: int) -> list[str]:
    """Os itens de IA que a pessoa tem, na ordem do catálogo."""
    from app.core.access_engine import effective_access  # import aqui para não fechar um ciclo com o motor

    access = effective_access(db, user_id)
    return [key for key in AI_ITEM_KEYS if access.has_global(key)]


def ai_permissions(db: Session, user_id: int) -> set[str]:
    """Resumo no formato antigo: ia.usar se pode usar o chat, ia.gerenciar se tem algum item de gerência."""
    items = ai_item_keys(db, user_id)
    granted: set[str] = set()
    if AI_USE in items:
        granted.add(AI_USE)
    if any(key in items for key in AI_MANAGE_ITEMS):
        granted.add(AI_MANAGE)
    return granted

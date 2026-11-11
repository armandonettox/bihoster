"""Nomes em portugues das acoes da auditoria. Ficam no backend para a busca por texto achar
"Login bloqueado" mesmo que o banco guarde `login_blocked`."""

ACTION_LABELS: dict[str, str] = {
    "login": "Login",
    "login_blocked": "Login bloqueado",
    "account_locked": "Conta bloqueada",
    "register": "Cadastro",
    "reset_password": "Senha redefinida",
    "generate_reset_link": "Link de redefinicao gerado",
    "change_password": "Senha alterada",
    "update_profile": "Perfil atualizado",
    "delete_user": "Membro removido",
    "update_auth_settings": "Configuracoes de autenticacao alteradas",
    "update_email_settings": "Configuracoes de e-mail alteradas",
    "send_test_email": "E-mail de teste enviado",
    "create": "Criado",
    "update": "Atualizado",
    "delete": "Excluido",
    "add_group_member": "Membro adicionado ao grupo",
    "invite_group_member": "Convite de grupo criado",
    "set_access": "Acesso de grupo alterado",
    "remove_access": "Acesso de grupo removido",
    "revert": "Acao revertida",
    "set_group_permissions": "Permissoes de grupo alteradas",
    "view_collection": "Colecao visitada",
    "view_report": "Relatorio aberto",
    "view_page": "Pagina visualizada",
    "apply_update": "Atualizacao do sistema aplicada",
    "ai_chat": "Pergunta ao chat de IA",
    "delete_ai_conversation": "Conversa de IA apagada",
    "delete_all_ai_conversations": "Conversas de IA apagadas",
    "test_ai_provider": "Provedor de IA testado",
    "update_ai_provider": "Provedor de IA alterado",
    "update_ai_options": "Opcoes de IA alteradas",
    "update_ai_report_settings": "IA do relatorio alterada",
    "view_ai_log": "Log da IA consultado",
    "subscription_created": "Assinatura criada",
    "subscription_updated": "Assinatura alterada",
    "subscription_deleted": "Assinatura excluida",
    "subscription_run_requested": "Envio de assinatura solicitado",
    "export_email_requested": "Envio por e-mail solicitado",
    "export_email_sent": "Envio por e-mail concluido",
    "alert_created": "Alerta criado",
    "alert_updated": "Alerta alterado",
    "alert_deleted": "Alerta excluido",
    "alert_triggered": "Alerta disparado",
}


# Tipo de recurso que a acao atingiu (coluna Recurso da auditoria)
ENTITY_LABELS: dict[str, str] = {
    "user": "Usuario",
    "workspace": "Colecao",
    "report": "Relatorio",
    "group": "Grupo",
    "system": "Sistema",
    "ai": "Chat de IA",
    "subscription": "Assinatura",
    "alert": "Alerta",
    "settings": "Configuracoes",
}


def entity_label(entity: str) -> str:
    return ENTITY_LABELS.get(entity, entity)


def action_label(action: str) -> str:
    return ACTION_LABELS.get(action, action)


def actions_matching(text: str) -> list[str]:
    """Codigos de acao cujo nome em portugues (ou o proprio codigo) contem o texto buscado."""
    needle = text.strip().lower()
    if not needle:
        return []
    return [code for code, label in ACTION_LABELS.items() if needle in label.lower() or needle in code]

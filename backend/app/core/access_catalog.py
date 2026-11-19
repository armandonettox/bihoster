"""Catálogo das permissões que grupos e pessoas podem receber (tabela access_grants).

Cada permissão tem um escopo: "workspace" (vale numa coleção) ou "global" (vale no sistema todo).
Uma permissão pode fazer parte de um *grupo de itens* (campo `feature`): na tela, o grupo tem um interruptor que
liga ou desliga todos os itens de uma vez, e cada item continua podendo ser ligado sozinho. O grupo em si não é
guardado, só os itens.

`requires` diz quais outras permissões precisam estar ligadas junto (criar assinatura exige ver as assinaturas).
Toda permissão de coleção exige "ver a coleção".

Os atalhos (Leitor, Editor, Administrador) só marcam várias caixas de uma vez na tela; eles não são guardados.

Onde cada item será cobrado pelo sistema (etapa de troca da regra):
- ia.chaves: /ai/settings (listar, salvar e testar provedores)
- ia.modelos: /ai/settings/{provedor}/models e /ai/options
- ia.bloqueios: /ai/reports (esquema, revisão, configuração e checagem de cada relatório)
- ia.registro: /ai/log;  ia.consumo: /ai/usage;  ia.usar: /ai/chat e o histórico próprio
- relatorio.editar: PUT do relatório;  relatorio.reordenar: /move;  relatorio.miniatura: /thumbnail
- assinatura.*: rotas de /subscriptions;  alerta.*: rotas de /alerts
- relatorio.exportar: /reports/{id}/export-email;  colecao.criar: POST /workspaces;  colecao.todas: GET /workspaces/all
- assinatura.*-outras e alerta.*-outras: as mesmas rotas, quando o item foi criado por outra pessoa;
- assinatura.todas: GET /subscriptions (visão do portal todo);  sistema.versao: GET /system/version, /history e /logs
- membros.*: rotas de /users e dos convites (membros.senha: /users/{id}/reset-link e /send-reset-email; membros.bloquear: /block e /unblock; membros.horario: /access-schedules; membros.liberar-horario: /access-extensions; membros.adicionar: /users/welcome-email)
- grupos.*: rotas de /groups (grupos.participantes: /groups/{id}/members);  permissoes.editar: PUT de /access/*
- conexao.*: /powerbi-connections;  auditoria.*: /audit, /audit/search e /audit/{id}/revert
- sistema.*: /settings (geral, marca, cache), autenticação e /email-settings
Fica só com o administrador da plataforma, sem permissão: atualizar a versão do sistema e conceder administrador (L-314).
"""

from dataclasses import dataclass

from app.core.permission_keys import ANALYTICS_CREATE, ANALYTICS_DELETE, ANALYTICS_EDIT, ANALYTICS_VIEW

WORKSPACE = "workspace"
GLOBAL = "global"

COLLECTION_VIEW = "colecao.ver"


@dataclass(frozen=True)
class Permission:
    key: str
    label: str
    description: str
    scope: str
    section: str
    # Grupo de itens a que pertence (vazio quando é uma permissão sozinha)
    feature: str | None = None
    feature_label: str | None = None
    feature_description: str | None = None
    # Outras permissões que precisam estar ligadas junto
    requires: tuple[str, ...] = ()


def _workspace(key, label, description, section, *, feature=None, requires=()):
    """Permissão de coleção: sempre exige ver a coleção (menos o próprio "ver a coleção")."""
    base = () if key == COLLECTION_VIEW else (COLLECTION_VIEW,)
    feature_key, feature_label, feature_description = feature if feature else (None, None, None)
    return Permission(
        key, label, description, WORKSPACE, section, feature_key, feature_label, feature_description, base + tuple(requires)
    )


def _global(key, label, description, section, *, feature=None, requires=()):
    feature_key, feature_label, feature_description = feature if feature else (None, None, None)
    return Permission(key, label, description, GLOBAL, section, feature_key, feature_label, feature_description, tuple(requires))


_REPORT_EDIT = ("relatorio-editar", "Editar relatórios", "Mudar um relatório que já existe na coleção.")
_SUBSCRIPTIONS = ("assinaturas", "Assinaturas por e-mail", "Envio recorrente de relatório por e-mail.")
_ALERTS = ("alertas", "Alertas de medidas", "Aviso por e-mail quando uma medida passa de um limite.")
_SUBSCRIPTIONS_OTHERS = ("assinaturas-outras", "Assinaturas de outras pessoas", "Ver e mexer nas assinaturas que outras pessoas criaram.")
_ALERTS_OTHERS = ("alertas-outras", "Alertas de outras pessoas", "Ver e mexer nos alertas que outras pessoas criaram.")
_AI_MANAGE = ("ia-gerenciar", "Gerenciar a IA", "Configurar a IA do portal: chaves, modelos, bloqueios e acompanhamento.")
_ANALYTICS = ("analiticos", "Painel de analíticos", "O painel de análise da auditoria.")
_MEMBERS = ("membros", "Membros", "Ver e cuidar das pessoas do portal.")
_GROUPS = ("grupos", "Grupos", "Ver e cuidar dos grupos de pessoas.")
_CONNECTIONS = ("conexoes", "Conexões do Power BI", "Ver e cuidar das conexões com o Power BI.")
_AUDIT = ("auditoria", "Auditoria geral", "O log de atividades de todo o portal.")
_SYSTEM = ("sistema", "Configurações do sistema", "As abas de configuração da Administração.")

CATALOG: tuple[Permission, ...] = (
    _workspace(COLLECTION_VIEW, "Ver a coleção", "Entrar na coleção e abrir os relatórios.", "Coleção"),
    _workspace("colecao.editar", "Editar a coleção", "Mudar nome, descrição, ícone, cor e tempo da TV.", "Coleção"),
    _workspace("colecao.excluir", "Excluir a coleção", "Apagar a coleção e tudo que tem dentro.", "Coleção"),
    _workspace("colecao.auditoria", "Ver a auditoria da coleção", "Ler o registro de ações feitas nesta coleção.", "Coleção"),
    _workspace("relatorio.publicar", "Publicar relatório", "Adicionar um relatório novo na coleção.", "Relatórios"),
    _workspace("relatorio.editar", "Editar os dados do relatório", "Mudar nome, descrição, página e configurações.", "Relatórios", feature=_REPORT_EDIT),
    _workspace("relatorio.reordenar", "Reordenar os relatórios", "Mudar a ordem dos relatórios na coleção.", "Relatórios", feature=_REPORT_EDIT),
    _workspace("relatorio.miniatura", "Gerenciar a miniatura", "Atualizar ou apagar a imagem de capa do relatório.", "Relatórios", feature=_REPORT_EDIT),
    _workspace("relatorio.excluir", "Excluir relatório", "Remover um relatório da coleção.", "Relatórios"),
    _workspace("relatorio.exportar", "Exportar por e-mail", "Enviar um relatório por e-mail, na hora, em PDF ou imagem.", "Relatórios"),
    _workspace("powerbi.atualizar", "Atualizar dados no Power BI", "Disparar a atualização do conjunto de dados.", "Relatórios"),
    _workspace("assinatura.ver", "Ver as minhas assinaturas", "Ver as assinaturas que você criou: quem recebe o quê, e o histórico de envios.", "Envios e alertas", feature=_SUBSCRIPTIONS),
    _workspace("assinatura.criar", "Criar assinaturas", "Cadastrar um envio recorrente novo.", "Envios e alertas", feature=_SUBSCRIPTIONS, requires=("assinatura.ver",)),
    _workspace("assinatura.editar", "Editar as minhas assinaturas", "Mudar destinatários, dias e horários das assinaturas que você criou.", "Envios e alertas", feature=_SUBSCRIPTIONS, requires=("assinatura.ver",)),
    _workspace("assinatura.excluir", "Excluir as minhas assinaturas", "Apagar um envio recorrente que você criou.", "Envios e alertas", feature=_SUBSCRIPTIONS, requires=("assinatura.ver",)),
    _workspace("assinatura.executar", "Enviar agora as minhas assinaturas", "Disparar na hora, fora do horário, um envio que você criou.", "Envios e alertas", feature=_SUBSCRIPTIONS, requires=("assinatura.ver",)),
    _workspace(
        "assinatura.qualquer-dominio",
        "Enviar para qualquer domínio",
        "Assinar sem a lista de domínios permitidos.",
        "Envios e alertas",
        feature=_SUBSCRIPTIONS,
        requires=("assinatura.criar",),
    ),
    _workspace("assinatura.ver-outras", "Ver as assinaturas de outras pessoas", "Ver as assinaturas criadas por outras pessoas na coleção.", "Envios e alertas", feature=_SUBSCRIPTIONS_OTHERS, requires=("assinatura.ver",)),
    _workspace("assinatura.editar-outras", "Editar as assinaturas de outras pessoas", "Mudar destinatários, dias e horários de assinaturas criadas por outras pessoas.", "Envios e alertas", feature=_SUBSCRIPTIONS_OTHERS, requires=("assinatura.editar", "assinatura.ver-outras")),
    _workspace("assinatura.excluir-outras", "Excluir as assinaturas de outras pessoas", "Apagar um envio recorrente criado por outra pessoa.", "Envios e alertas", feature=_SUBSCRIPTIONS_OTHERS, requires=("assinatura.excluir", "assinatura.ver-outras")),
    _workspace("assinatura.executar-outras", "Enviar agora as assinaturas de outras pessoas", "Disparar na hora um envio criado por outra pessoa.", "Envios e alertas", feature=_SUBSCRIPTIONS_OTHERS, requires=("assinatura.executar", "assinatura.ver-outras")),
    _workspace("alerta.ver", "Ver os meus alertas", "Ver os alertas que você criou e as medidas do relatório.", "Envios e alertas", feature=_ALERTS),
    _workspace("alerta.criar", "Criar alertas", "Cadastrar um alerta novo.", "Envios e alertas", feature=_ALERTS, requires=("alerta.ver",)),
    _workspace("alerta.editar", "Editar os meus alertas", "Mudar o limite e os destinatários dos alertas que você criou.", "Envios e alertas", feature=_ALERTS, requires=("alerta.ver",)),
    _workspace("alerta.excluir", "Excluir os meus alertas", "Apagar um alerta que você criou.", "Envios e alertas", feature=_ALERTS, requires=("alerta.ver",)),
    _workspace("alerta.ver-outras", "Ver os alertas de outras pessoas", "Ver os alertas criados por outras pessoas na coleção.", "Envios e alertas", feature=_ALERTS_OTHERS, requires=("alerta.ver",)),
    _workspace("alerta.editar-outras", "Editar os alertas de outras pessoas", "Mudar o limite e os destinatários de alertas criados por outras pessoas.", "Envios e alertas", feature=_ALERTS_OTHERS, requires=("alerta.editar", "alerta.ver-outras")),
    _workspace("alerta.excluir-outras", "Excluir os alertas de outras pessoas", "Apagar um alerta criado por outra pessoa.", "Envios e alertas", feature=_ALERTS_OTHERS, requires=("alerta.excluir", "alerta.ver-outras")),
    _global("ia.usar", "Usar o chat de IA", "Conversar com a IA sobre os dados dos relatórios e ver o próprio histórico.", "Inteligência artificial"),
    _global("ia.chaves", "Configurar chaves e provedores", "Cadastrar, trocar e testar as chaves de API da IA.", "Inteligência artificial", feature=_AI_MANAGE),
    _global("ia.modelos", "Escolher modelos e opções", "Escolher os modelos disponíveis e as opções da IA.", "Inteligência artificial", feature=_AI_MANAGE),
    _global("ia.bloqueios", "Bloquear colunas dos relatórios", "Decidir o que a IA pode ler de cada relatório e revisar.", "Inteligência artificial", feature=_AI_MANAGE),
    _global("ia.registro", "Ver o registro de uso", "Ler o histórico de perguntas e respostas da IA.", "Inteligência artificial", feature=_AI_MANAGE),
    _global("ia.consumo", "Ver o consumo e os custos", "Acompanhar quanto a IA gastou.", "Inteligência artificial", feature=_AI_MANAGE),
    _global(ANALYTICS_VIEW, "Ver os analíticos", "Abrir o painel de analíticos da auditoria.", "Analíticos", feature=_ANALYTICS),
    _global(ANALYTICS_CREATE, "Criar visuais", "Adicionar visuais ao painel.", "Analíticos", feature=_ANALYTICS, requires=(ANALYTICS_VIEW,)),
    _global(ANALYTICS_EDIT, "Editar visuais", "Mudar e reorganizar os visuais do painel.", "Analíticos", feature=_ANALYTICS, requires=(ANALYTICS_VIEW,)),
    _global(ANALYTICS_DELETE, "Excluir visuais", "Remover visuais do painel.", "Analíticos", feature=_ANALYTICS, requires=(ANALYTICS_VIEW,)),
    # Administração: cada aba tem os seus itens, para dar só o que a pessoa precisa
    _global("membros.ver", "Ver os membros", "Abrir Gerenciar usuários e ver as pessoas, os grupos e as permissões de cada uma.", "Gerenciar usuários", feature=_MEMBERS),
    _global("membros.adicionar", "Adicionar membros", "Convidar e cadastrar pessoas novas, e mandar por e-mail o aviso de que foram adicionadas.", "Gerenciar usuários", feature=_MEMBERS, requires=("membros.ver",)),
    _global("membros.editar", "Editar membros", "Mudar os dados e os grupos de uma pessoa.", "Gerenciar usuários", feature=_MEMBERS, requires=("membros.ver",)),
    _global("membros.remover", "Remover membros", "Apagar uma pessoa do portal.", "Gerenciar usuários", feature=_MEMBERS, requires=("membros.ver",)),
    _global("membros.convites", "Gerenciar convites", "Reenviar e cancelar convites que ainda não foram usados.", "Gerenciar usuários", feature=_MEMBERS, requires=("membros.ver",)),
    _global("membros.bloquear", "Bloquear e desbloquear", "Impedir uma pessoa de entrar (e desfazer o bloqueio).", "Gerenciar usuários", feature=_MEMBERS, requires=("membros.ver",)),
    _global("membros.horario", "Definir horários de acesso", "Escolher em que dias e horas grupos e pessoas podem usar o sistema.", "Gerenciar usuários", feature=_MEMBERS, requires=("membros.ver",)),
    _global("membros.liberar-horario", "Liberar acesso fora do horário", "Aprovar ou recusar pedidos de mais tempo de acesso e encerrar liberações.", "Gerenciar usuários", feature=_MEMBERS, requires=("membros.ver",)),
    _global("membros.senha", "Gerar ou enviar link de nova senha", "Copiar o link para uma pessoa criar uma senha nova, ou mandá-lo por e-mail para ela.", "Gerenciar usuários", feature=_MEMBERS, requires=("membros.ver",)),
    # Ver os grupos mostra nome e e-mail de quem está em cada um, então exige ver os membros (a área "Gerenciar usuários" junta as duas)
    _global("grupos.ver", "Ver os grupos", "Ver os grupos e quem faz parte de cada um.", "Gerenciar usuários", feature=_GROUPS, requires=("membros.ver",)),
    _global("grupos.criar", "Criar grupos", "Cadastrar um grupo novo.", "Gerenciar usuários", feature=_GROUPS, requires=("grupos.ver",)),
    _global("grupos.editar", "Editar grupos", "Mudar nome e participantes de um grupo.", "Gerenciar usuários", feature=_GROUPS, requires=("grupos.ver",)),
    _global("grupos.excluir", "Excluir grupos", "Apagar um grupo.", "Gerenciar usuários", feature=_GROUPS, requires=("grupos.ver",)),
    _global("grupos.participantes", "Gerenciar participantes", "Colocar e tirar pessoas de um grupo.", "Gerenciar usuários", feature=_GROUPS, requires=("grupos.ver",)),
    _global(
        "permissoes.editar",
        "Dar e tirar permissões",
        "Mudar as permissões de pessoas e grupos.",
        "Gerenciar usuários",
        requires=("membros.ver", "grupos.ver"),
    ),
    _global("colecao.todas", "Ver todas as coleções", "Abrir a aba Coleções e ver todas, mesmo as que a pessoa não acessa.", "Administração: coleções"),
    _global("colecao.criar", "Criar coleções", "Cadastrar uma coleção nova no portal.", "Administração: coleções", requires=("colecao.todas",)),
    _global("assinatura.todas", "Ver as assinaturas de todo o portal", "Abrir a aba Assinaturas e ver os envios de todas as coleções.", "Administração: coleções"),
    _global("conexao.ver", "Ver as conexões do Power BI", "Ver as conexões cadastradas, sem os segredos.", "Administração: Power BI", feature=_CONNECTIONS),
    _global("conexao.criar", "Cadastrar conexões", "Adicionar uma conexão nova com o Power BI.", "Administração: Power BI", feature=_CONNECTIONS, requires=("conexao.ver",)),
    _global("conexao.editar", "Editar conexões", "Mudar os dados de uma conexão.", "Administração: Power BI", feature=_CONNECTIONS, requires=("conexao.ver",)),
    _global("conexao.excluir", "Excluir conexões", "Remover uma conexão.", "Administração: Power BI", feature=_CONNECTIONS, requires=("conexao.ver",)),
    _global("auditoria.ver", "Ver o log de atividades", "Abrir a auditoria geral e pesquisar as ações de todo o portal.", "Administração: auditoria", feature=_AUDIT),
    _global("auditoria.reverter", "Reverter ações", "Desfazer uma ação registrada na auditoria.", "Administração: auditoria", feature=_AUDIT, requires=("auditoria.ver",)),
    _global("sistema.geral", "Configurações gerais", "Mudar nome do portal e demais opções da aba Geral.", "Administração: sistema", feature=_SYSTEM),
    _global("sistema.marca", "Marca", "Trocar logo, favicon e imagem de login.", "Administração: sistema", feature=_SYSTEM),
    _global("sistema.autenticacao", "Autenticação", "Mudar as formas de entrada, como senha e Google.", "Administração: sistema", feature=_SYSTEM),
    _global("sistema.email", "E-mail do sistema", "Configurar o servidor de e-mail e enviar um teste.", "Administração: sistema", feature=_SYSTEM),
    _global("sistema.cache", "Cache", "Ver o uso e limpar o cache.", "Administração: sistema", feature=_SYSTEM),
    _global("sistema.versao", "Ver a versão e as atualizações", "Ver a versão instalada, o histórico e os registros de atualização (aplicar a atualização fica só com o administrador).", "Administração: sistema", feature=_SYSTEM),
)

_BY_KEY = {p.key: p for p in CATALOG}

WORKSPACE_KEYS: tuple[str, ...] = tuple(p.key for p in CATALOG if p.scope == WORKSPACE)
GLOBAL_KEYS: tuple[str, ...] = tuple(p.key for p in CATALOG if p.scope == GLOBAL)


def _items_of(feature: str) -> tuple[str, ...]:
    return tuple(p.key for p in CATALOG if p.feature == feature)


# Itens que nenhum atalho liga: só valem quando alguém os liga de propósito. Exportar por e-mail faz dado de beneficiário
# sair do sistema e hoje é só do administrador da plataforma, então o atalho "Administrador" da coleção não o inclui.
NOT_IN_PRESETS: frozenset[str] = frozenset({"relatorio.exportar"})

# Cada permissão de assinatura e de alerta vale só para o que a própria pessoa criou; as "-outras" valem para o que outras
# pessoas criaram. Na atualização, quem já tinha a permissão simples ganha a "-outras" equivalente (ver
# core/access_migration.py), para ninguém perder acesso.
OWN_TO_OTHERS: dict[str, str] = {
    "assinatura.ver": "assinatura.ver-outras",
    "assinatura.editar": "assinatura.editar-outras",
    "assinatura.excluir": "assinatura.excluir-outras",
    "assinatura.executar": "assinatura.executar-outras",
    "alerta.ver": "alerta.ver-outras",
    "alerta.editar": "alerta.editar-outras",
    "alerta.excluir": "alerta.excluir-outras",
}

# Atalhos da tela: só preenchem caixas, não ficam guardados. O atalho Editor liga só as permissões "minhas": mexer no que
# outras pessoas criaram se liga à parte. O Administrador da coleção liga tudo.
PRESETS: dict[str, tuple[str, ...]] = {
    "leitor": (COLLECTION_VIEW,),
    "editor": (
        COLLECTION_VIEW,
        "relatorio.publicar",
        *_items_of("relatorio-editar"),
        "relatorio.excluir",
        "powerbi.atualizar",
        "assinatura.ver",
        "assinatura.criar",
        "assinatura.editar",
        "assinatura.excluir",
        "assinatura.executar",
        *_items_of("alertas"),
    ),
    "administrador": tuple(key for key in WORKSPACE_KEYS if key not in NOT_IN_PRESETS),
}

# O modelo antigo tinha uma permissão só para cada um destes grupos; ao copiar os dados, ela vira todos os itens
LEGACY_EXPANSIONS: dict[str, tuple[str, ...]] = {
    "ia.gerenciar": _items_of("ia-gerenciar"),
}


def scope_of(key: str) -> str | None:
    permission = _BY_KEY.get(key)
    return permission.scope if permission else None


def get(key: str) -> Permission | None:
    return _BY_KEY.get(key)


def with_implied(keys: set[str] | list[str] | tuple[str, ...]) -> list[str]:
    """Sem repetidos e em ordem do catálogo. Junta tudo o que as permissões escolhidas exigem, e o que estas exigem
    por sua vez (criar assinatura exige ver as assinaturas; qualquer permissão de coleção exige ver a coleção)."""
    result = set(keys)
    pending = list(result)
    while pending:
        permission = _BY_KEY.get(pending.pop())
        if not permission:
            continue
        for required in permission.requires:
            if required not in result:
                result.add(required)
                pending.append(required)
    order = {p.key: index for index, p in enumerate(CATALOG)}
    return sorted(result, key=lambda key: order.get(key, len(order)))

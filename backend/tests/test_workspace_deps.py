"""Testa a logica de permissao por grupos globais -- e a parte mais sensivel do sistema:
um bug aqui vaza (ou nega) acesso a colecoes inteiras. Cobre get_effective_role,
get_effective_roles_map e o bypass do grupo Administradores."""

from app.core.workspace_deps import (
    add_user_to_admin_group,
    ensure_user_in_default_group,
    get_effective_role,
    get_effective_roles_map,
    get_or_create_admin_group,
    get_or_create_default_group,
    is_platform_admin,
)
from app.models.user import UserRole
from app.models.workspace import GroupWorkspaceAccess


def test_usuario_sem_grupo_nenhum_nao_tem_acesso(db_session, make_user, make_workspace):
    user = make_user("solto@teste.com")
    workspace = make_workspace("Financeiro")

    assert get_effective_role(db_session, user.id, workspace.id) is None
    assert get_effective_roles_map(db_session, user.id) == {}


def test_grupo_padrao_da_acesso_minimo_garantido(db_session, make_user, make_workspace):
    user = make_user("comum@teste.com")
    workspace = make_workspace("Financeiro")

    ensure_user_in_default_group(db_session, user.id)
    default_group = get_or_create_default_group(db_session)
    db_session.add(GroupWorkspaceAccess(group_id=default_group.id, workspace_id=workspace.id, role=UserRole.viewer))
    db_session.commit()

    assert get_effective_role(db_session, user.id, workspace.id) == UserRole.viewer


def test_admin_da_plataforma_tem_bypass_total_mesmo_sem_matriz(db_session, make_user, make_workspace):
    """Membro do grupo Administradores e admin em QUALQUER colecao, mesmo sem nenhuma
    linha na GroupWorkspaceAccess -- e o bypass documentado, nao um bug."""
    admin = make_user("admin@teste.com")
    workspace = make_workspace("RH")

    add_user_to_admin_group(db_session, admin.id)

    assert is_platform_admin(db_session, admin.id) is True
    assert get_effective_role(db_session, admin.id, workspace.id) == UserRole.admin
    assert get_effective_roles_map(db_session, admin.id) == {workspace.id: UserRole.admin}


def test_maior_papel_entre_multiplos_grupos_prevalece(db_session, make_user, make_workspace):
    """Usuario em dois grupos com niveis diferentes na mesma colecao deve ficar com o MAIOR
    dos dois (editor > viewer), nao o primeiro encontrado nem o menor."""
    from app.models.workspace import Group, GroupMember

    user = make_user("dois-grupos@teste.com")
    workspace = make_workspace("Comercial")

    grupo_viewer = Group(name="So ve")
    grupo_editor = Group(name="Edita")
    db_session.add_all([grupo_viewer, grupo_editor])
    db_session.commit()

    db_session.add_all([
        GroupMember(group_id=grupo_viewer.id, user_id=user.id),
        GroupMember(group_id=grupo_editor.id, user_id=user.id),
        GroupWorkspaceAccess(group_id=grupo_viewer.id, workspace_id=workspace.id, role=UserRole.viewer),
        GroupWorkspaceAccess(group_id=grupo_editor.id, workspace_id=workspace.id, role=UserRole.editor),
    ])
    db_session.commit()

    assert get_effective_role(db_session, user.id, workspace.id) == UserRole.editor


def test_acesso_nao_vaza_entre_colecoes_diferentes(db_session, make_user, make_workspace):
    """Acesso configurado numa colecao nao deve aparecer em outra -- e o teste mais direto
    contra vazamento cross-tenant de dados de saude entre colecoes."""
    from app.models.workspace import Group, GroupMember

    user = make_user("restrito@teste.com")
    workspace_permitido = make_workspace("Comercial")
    workspace_vedado = make_workspace("Diretoria")

    grupo = Group(name="Comercial Team")
    db_session.add(grupo)
    db_session.commit()

    db_session.add_all([
        GroupMember(group_id=grupo.id, user_id=user.id),
        GroupWorkspaceAccess(group_id=grupo.id, workspace_id=workspace_permitido.id, role=UserRole.editor),
    ])
    db_session.commit()

    assert get_effective_role(db_session, user.id, workspace_permitido.id) == UserRole.editor
    assert get_effective_role(db_session, user.id, workspace_vedado.id) is None

    roles_map = get_effective_roles_map(db_session, user.id)
    assert roles_map == {workspace_permitido.id: UserRole.editor}


def test_grupo_admin_bootstrap_e_idempotente(db_session):
    """Chamar get_or_create_admin_group/get_or_create_default_group varias vezes nao deve
    duplicar os grupos globais (backfill/bootstrap preguicoso usado em varios routers)."""
    g1 = get_or_create_admin_group(db_session)
    g2 = get_or_create_admin_group(db_session)
    d1 = get_or_create_default_group(db_session)
    d2 = get_or_create_default_group(db_session)

    assert g1.id == g2.id
    assert d1.id == d2.id

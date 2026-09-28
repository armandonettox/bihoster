import threading
from typing import Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.workspace import Group, GroupMember, GroupWorkspaceAccess
from app.routers.auth import get_current_user

ROLE_ORDER = {UserRole.viewer: 0, UserRole.editor: 1, UserRole.admin: 2}

DEFAULT_GROUP_NAME = "Todos os usuarios"
ADMIN_GROUP_NAME = "Administradores"

# Serializa as secoes criticas de bootstrap/composicao do grupo Administradores (criar o grupo,
# virar o primeiro admin, remover o ultimo admin) -- sem isso, duas requisicoes concorrentes na
# threadpool do FastAPI podem ambas passar pela checagem "existe?"/"sobra mais de um?" antes de
# qualquer commit, duplicando grupos padrao/admin ou esvaziando o grupo Administradores.
# So protege dentro de um processo (uvicorn com 1 worker, cenario deste projeto pessoal/solo).
admin_group_lock = threading.RLock()


def get_or_create_default_group(db: Session) -> Group:
    """Grupo global 'Todos os usuarios' (estilo Metabase 'All Users') -- todo usuario cadastrado entra nele."""
    with admin_group_lock:
        group = db.query(Group).filter(Group.is_default.is_(True)).first()
        if not group:
            group = Group(name=DEFAULT_GROUP_NAME, is_default=True)
            db.add(group)
            db.commit()
            db.refresh(group)

            # Backfill: usuarios cadastrados antes desse recurso existir
            existing_user_ids = [u.id for u in db.query(User.id).all()]
            for user_id in existing_user_ids:
                db.add(GroupMember(group_id=group.id, user_id=user_id))
            db.commit()
        return group


def get_or_create_admin_group(db: Session) -> Group:
    """Grupo global 'Administradores' -- membros tem acesso admin em toda a plataforma."""
    with admin_group_lock:
        group = db.query(Group).filter(Group.is_admin_group.is_(True)).first()
        if not group:
            group = Group(name=ADMIN_GROUP_NAME, is_admin_group=True)
            db.add(group)
            db.commit()
            db.refresh(group)
        return group


def ensure_user_in_default_group(db: Session, user_id: int) -> None:
    group = get_or_create_default_group(db)
    exists = db.query(GroupMember).filter(GroupMember.group_id == group.id, GroupMember.user_id == user_id).first()
    if not exists:
        db.add(GroupMember(group_id=group.id, user_id=user_id))
        db.commit()


def add_user_to_admin_group(db: Session, user_id: int) -> None:
    group = get_or_create_admin_group(db)
    exists = db.query(GroupMember).filter(GroupMember.group_id == group.id, GroupMember.user_id == user_id).first()
    if not exists:
        db.add(GroupMember(group_id=group.id, user_id=user_id))
        db.commit()


def ensure_default_group_access(db: Session, workspace_id: int, role: UserRole = UserRole.viewer) -> None:
    """Da ao grupo padrao um nivel de acesso base numa colecao recem criada (admin pode mudar depois)."""
    default_group = get_or_create_default_group(db)
    exists = (
        db.query(GroupWorkspaceAccess)
        .filter(GroupWorkspaceAccess.group_id == default_group.id, GroupWorkspaceAccess.workspace_id == workspace_id)
        .first()
    )
    if not exists:
        db.add(GroupWorkspaceAccess(group_id=default_group.id, workspace_id=workspace_id, role=role))
        db.commit()


def is_platform_admin(db: Session, user_id: int) -> bool:
    admin_group = db.query(Group).filter(Group.is_admin_group.is_(True)).first()
    if not admin_group:
        return False
    return (
        db.query(GroupMember)
        .filter(GroupMember.group_id == admin_group.id, GroupMember.user_id == user_id)
        .first()
        is not None
    )


def get_effective_role(db: Session, user_id: int, workspace_id: int) -> Optional[UserRole]:
    """Papel do usuario numa colecao -- vem exclusivamente dos grupos a que ele pertence
    (bypass total se for do grupo Administradores). Nao existe mais papel atribuido direto a pessoa."""
    if is_platform_admin(db, user_id):
        return UserRole.admin

    group_roles = (
        db.query(GroupWorkspaceAccess.role)
        .join(GroupMember, GroupMember.group_id == GroupWorkspaceAccess.group_id)
        .filter(GroupWorkspaceAccess.workspace_id == workspace_id, GroupMember.user_id == user_id)
        .all()
    )

    if not group_roles:
        return None

    return max((role for (role,) in group_roles), key=lambda r: ROLE_ORDER[r])


def get_effective_roles_map(db: Session, user_id: int) -> dict[int, UserRole]:
    """Versao em lote de get_effective_role -- calcula o papel efetivo do usuario em TODAS as
    colecoes com uma unica query, em vez de N queries (uma por colecao) num loop no chamador."""
    if is_platform_admin(db, user_id):
        from app.models.workspace import Workspace

        return {w.id: UserRole.admin for w in db.query(Workspace.id).all()}

    rows = (
        db.query(GroupWorkspaceAccess.workspace_id, GroupWorkspaceAccess.role)
        .join(GroupMember, GroupMember.group_id == GroupWorkspaceAccess.group_id)
        .filter(GroupMember.user_id == user_id)
        .all()
    )

    roles_by_workspace: dict[int, UserRole] = {}
    for workspace_id, role in rows:
        current = roles_by_workspace.get(workspace_id)
        if current is None or ROLE_ORDER[role] > ROLE_ORDER[current]:
            roles_by_workspace[workspace_id] = role
    return roles_by_workspace


def require_workspace_member(workspace_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> User:
    role = get_effective_role(db, current_user.id, workspace_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Voce nao tem acesso a esta colecao")
    return current_user


def require_platform_admin(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> User:
    if not is_platform_admin(db, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Voce precisa estar no grupo Administradores para essa acao",
        )
    return current_user


def require_any_editor(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> User:
    """Usado por endpoints que nao sao de uma colecao especifica (ex: catalogo do Power BI) mas
    ainda assim nao devem ficar abertos a qualquer usuario logado -- exige ter pelo menos papel
    de editor/admin em alguma colecao, ja que so esses papeis podem criar/editar relatorios."""
    roles = get_effective_roles_map(db, current_user.id)
    if not any(role in (UserRole.editor, UserRole.admin) for role in roles.values()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Voce precisa ser editor ou admin em pelo menos uma colecao para essa acao",
        )
    return current_user


def require_workspace_role(*allowed_roles: UserRole):
    def dependency(
        workspace_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        role = get_effective_role(db, current_user.id, workspace_id)
        if role is None or role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Voce nao tem permissao para essa acao nesta colecao",
            )
        return current_user

    return dependency

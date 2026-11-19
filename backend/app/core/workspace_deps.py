import threading
from typing import Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.workspace import Group, GroupMember
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
    """Da ao grupo padrao um nivel de acesso base numa colecao recem criada (admin pode mudar depois).
    O acesso e gravado como permissoes (as do atalho do papel); se o grupo ja tem algo na colecao, nao mexe."""
    from app.core.access_roles import get_group_role, set_group_role  # import aqui para nao fechar um ciclo

    default_group = get_or_create_default_group(db)
    if get_group_role(db, default_group.id, workspace_id) is None:
        set_group_role(db, default_group.id, workspace_id, role)
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
    """Papel do usuario numa colecao, calculado a partir das permissoes dele (as que vem dos grupos somadas as que
    foram dadas a ele; bypass total se for do grupo Administradores). Ver core/access_roles.py."""
    if is_platform_admin(db, user_id):
        return UserRole.admin

    from app.core.access_engine import effective_access  # imports aqui para nao fechar um ciclo com o motor
    from app.core.access_roles import role_from_keys

    keys = effective_access(db, user_id).by_workspace.get(workspace_id)
    return role_from_keys(keys)


def get_effective_roles_map(db: Session, user_id: int) -> dict[int, UserRole]:
    """Versao em lote de get_effective_role -- calcula o papel efetivo do usuario em TODAS as
    colecoes com uma unica busca, em vez de N (uma por colecao) num loop no chamador."""
    if is_platform_admin(db, user_id):
        from app.models.workspace import Workspace

        return {w.id: UserRole.admin for w in db.query(Workspace.id).all()}

    from app.core.access_engine import effective_access
    from app.core.access_roles import role_from_keys

    roles: dict[int, UserRole] = {}
    for workspace_id, keys in effective_access(db, user_id).by_workspace.items():
        role = role_from_keys(keys)
        if role is not None:
            roles[workspace_id] = role
    return roles


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

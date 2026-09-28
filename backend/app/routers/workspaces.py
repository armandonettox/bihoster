from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.slug import slugify
from app.core.workspace_deps import (
    ensure_default_group_access,
    get_effective_role,
    get_effective_roles_map,
    require_platform_admin,
    require_workspace_member,
    require_workspace_role,
)
from app.models.audit_log import AuditLog
from app.models.favorite import Favorite
from app.models.report import Report
from app.models.settings import AppSettings
from app.models.user import User, UserRole
from app.models.workspace import Group, GroupWorkspaceAccess, Workspace
from app.routers.auth import get_current_user
from app.schemas.workspace import (
    AccessUpdate,
    WorkspaceAccessOut,
    WorkspaceCreate,
    WorkspaceOut,
    WorkspaceUpdate,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _unique_slug(db: Session, name: str) -> str:
    base = slugify(name)
    slug = base
    counter = 2
    while db.query(Workspace).filter(Workspace.slug == slug).first():
        slug = f"{base}-{counter}"
        counter += 1
    return slug


def _to_out(workspace: Workspace, role: UserRole) -> WorkspaceOut:
    return WorkspaceOut(
        id=workspace.id,
        name=workspace.name,
        slug=workspace.slug,
        description=workspace.description,
        icon=workspace.icon,
        color=workspace.color,
        tv_interval_seconds=workspace.tv_interval_seconds,
        role=role,
    )


@router.get("/", response_model=list[WorkspaceOut])
def list_my_workspaces(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """So as colecoes que o usuario realmente enxerga -- acesso vem exclusivamente dos grupos dele."""
    roles_by_workspace = get_effective_roles_map(db, current_user.id)
    result = []
    for workspace in db.query(Workspace).order_by(Workspace.name).all():
        role = roles_by_workspace.get(workspace.id)
        if role is not None:
            result.append(_to_out(workspace, role))
    return result


@router.get("/all", response_model=list[WorkspaceOut])
def list_all_workspaces(db: Session = Depends(get_db), current_user: User = Depends(require_platform_admin)):
    """Todas as colecoes do sistema -- usado no painel de gestao (admin da plataforma).
    Quem chega aqui ja passou por require_platform_admin, entao o papel e sempre admin."""
    workspaces = db.query(Workspace).order_by(Workspace.name).all()
    return [_to_out(w, UserRole.admin) for w in workspaces]


@router.post("/", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
def create_workspace(
    data: WorkspaceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    # Retry em cima de IntegrityError (nao so a checagem previa) -- duas criacoes concorrentes
    # com o mesmo nome podem passar pelo _unique_slug antes de qualquer commit e colidir no
    # commit; sem o retry, a segunda simplesmente falharia com um 500 em vez de tentar de novo.
    for attempt in range(5):
        workspace = Workspace(
            name=data.name,
            slug=_unique_slug(db, data.name),
            description=data.description,
            icon=data.icon,
            color=data.color,
        )
        db.add(workspace)
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            if attempt == 4:
                raise HTTPException(status_code=409, detail="Nao foi possivel gerar um identificador unico para essa colecao -- tente novamente")
    db.refresh(workspace)

    ensure_default_group_access(db, workspace.id, UserRole.viewer)

    log_action(db, action="create", entity="workspace", user_id=current_user.id, workspace_id=workspace.id, details=workspace.name)
    return _to_out(workspace, UserRole.admin)


@router.get("/{workspace_id}", response_model=WorkspaceOut)
def get_workspace(
    workspace_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workspace_member),
):
    workspace = db.query(Workspace).get(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Colecao nao encontrada")
    role = get_effective_role(db, current_user.id, workspace_id)
    return _to_out(workspace, role)


@router.put("/{workspace_id}", response_model=WorkspaceOut)
def update_workspace(
    workspace_id: int,
    data: WorkspaceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workspace_role(UserRole.admin)),
):
    workspace = db.query(Workspace).get(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Colecao nao encontrada")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(workspace, field, value)
    db.commit()
    db.refresh(workspace)

    log_action(db, action="update", entity="workspace", user_id=current_user.id, workspace_id=workspace_id, details=workspace.name)
    return _to_out(workspace, UserRole.admin)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(
    workspace_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_workspace_role(UserRole.admin)),
):
    workspace = db.query(Workspace).get(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Colecao nao encontrada")

    report_ids = [r.id for r in db.query(Report.id).filter(Report.collection_id == workspace_id).all()]
    if report_ids:
        db.query(Favorite).filter(Favorite.report_id.in_(report_ids)).delete(synchronize_session=False)

    db.query(AuditLog).filter(AuditLog.workspace_id == workspace_id).update(
        {"workspace_id": None}, synchronize_session=False
    )

    db.delete(workspace)

    settings_row = db.query(AppSettings).filter(AppSettings.id == 1, AppSettings.default_workspace_id == workspace_id).first()
    if settings_row:
        settings_row.default_workspace_id = None

    db.commit()


@router.get("/{workspace_id}/access", response_model=list[WorkspaceAccessOut])
def get_workspace_access(
    workspace_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    """Matriz de acesso -- nivel de cada grupo global nesta colecao (None = sem acesso)."""
    groups = db.query(Group).order_by(Group.is_admin_group.desc(), Group.is_default.desc(), Group.name).all()
    access_by_group = {
        a.group_id: a.role
        for a in db.query(GroupWorkspaceAccess).filter(GroupWorkspaceAccess.workspace_id == workspace_id).all()
    }
    return [
        WorkspaceAccessOut(
            group_id=g.id,
            group_name=g.name,
            is_default=g.is_default,
            is_admin_group=g.is_admin_group,
            role=access_by_group.get(g.id),
        )
        for g in groups
    ]


@router.put("/{workspace_id}/access/{group_id}", response_model=WorkspaceAccessOut)
def set_workspace_access(
    workspace_id: int,
    group_id: int,
    data: AccessUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    group = db.query(Group).get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")
    if not db.query(Workspace).get(workspace_id):
        raise HTTPException(status_code=404, detail="Colecao nao encontrada")

    access = (
        db.query(GroupWorkspaceAccess)
        .filter(GroupWorkspaceAccess.group_id == group_id, GroupWorkspaceAccess.workspace_id == workspace_id)
        .first()
    )
    if access:
        access.role = data.role
    else:
        access = GroupWorkspaceAccess(group_id=group_id, workspace_id=workspace_id, role=data.role)
        db.add(access)
    db.commit()

    log_action(
        db,
        action="set_access",
        entity="workspace",
        user_id=current_user.id,
        workspace_id=workspace_id,
        entity_id=group_id,
        details=f"{group.name} -> {data.role.value}",
    )
    return WorkspaceAccessOut(
        group_id=group.id, group_name=group.name, is_default=group.is_default, is_admin_group=group.is_admin_group, role=data.role
    )


@router.delete("/{workspace_id}/access/{group_id}", response_model=WorkspaceAccessOut)
def remove_workspace_access(
    workspace_id: int,
    group_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    group = db.query(Group).get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")

    access = (
        db.query(GroupWorkspaceAccess)
        .filter(GroupWorkspaceAccess.group_id == group_id, GroupWorkspaceAccess.workspace_id == workspace_id)
        .first()
    )
    if access:
        db.delete(access)
        db.commit()

    return WorkspaceAccessOut(
        group_id=group.id, group_name=group.name, is_default=group.is_default, is_admin_group=group.is_admin_group, role=None
    )

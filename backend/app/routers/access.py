"""Permissoes unificadas: lista unica de permissoes por grupo e por pessoa, global ou por colecao.

Etapa 1 do plano: esta API le e grava access_grants. As regras do sistema ainda usam o modelo antigo
(papel por colecao), a troca acontece numa etapa seguinte."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.access_catalog import PRESETS, scope_of
from app.core.access_deps import require_any_global_permission, require_global_permission
from app.core.access_engine import effective_access
from app.core.access_guard import (
    check_can_change_grants,
    check_can_give_keys,
    current_keys_by_scope,
    keys_by_scope_of_blocks,
)
from app.core.access_pending import replace_pending
from app.core.access_report import build_report
from app.core.audit import log_action
from app.core.database import get_db
from app.core.workspace_deps import is_platform_admin
from app.models.access_grant import AccessGrant
from app.models.invite import GroupInvite
from app.models.user import User
from app.models.workspace import Group, Workspace
from app.routers.auth import get_current_user
from app.schemas.access import AccessReportOut, ByEmailOut, CatalogOut, GrantsByEmail, GroupGrantsOut, GroupsGrantsOut, GrantBlock, GrantsOut, GrantsUpdate, MyAccessOut, catalog_out

router = APIRouter(prefix="/access", tags=["access"])


@router.get("/catalog", response_model=CatalogOut)
def get_catalog(_=Depends(require_any_global_permission("membros.ver", "grupos.ver", "permissoes.editar"))):
    return catalog_out(PRESETS)


@router.get("/report", response_model=AccessReportOut)
def access_report(
    search: str = "",
    group_id: int | None = None,
    scope: str | None = None,
    permission: str | None = None,
    only_direct: bool = False,
    user_id: int | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_global_permission("membros.ver")),
):
    """Quem pode o quê: uma linha por pessoa e escopo, com a origem de cada permissão. Só consulta."""
    if scope is not None and scope != "global" and not scope.isdigit():
        raise HTTPException(status_code=422, detail="Escopo inválido")
    if permission is not None and scope_of(permission) is None:
        raise HTTPException(status_code=422, detail="Permissão inválida")
    return AccessReportOut(rows=build_report(db, search, group_id, scope, permission, only_direct, user_id))


@router.get("/me", response_model=MyAccessOut)
def my_access(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    access = effective_access(db, current_user.id)
    return MyAccessOut(
        is_admin=access.is_admin,
        global_permissions=sorted(access.global_keys),
        workspace_permissions={wid: sorted(keys) for wid, keys in access.by_workspace.items()},
    )


def _blocks(rows) -> list[GrantBlock]:
    by_scope: dict[int | None, list[str]] = {}
    for row in rows:
        by_scope.setdefault(row.workspace_id, []).append(row.permission_key)
    # Global primeiro, depois as colecoes em ordem de id
    ordered = sorted(by_scope, key=lambda wid: (wid is not None, wid or 0))
    return [GrantBlock(workspace_id=wid, permissions=by_scope[wid]) for wid in ordered]


def _replace(db: Session, subject: dict, update: GrantsUpdate) -> None:
    workspace_ids = {b.workspace_id for b in update.blocks if b.workspace_id is not None}
    if workspace_ids:
        found = {row.id for row in db.query(Workspace.id).filter(Workspace.id.in_(workspace_ids)).all()}
        missing = workspace_ids - found
        if missing:
            raise HTTPException(status_code=404, detail="Colecao nao encontrada")

    db.query(AccessGrant).filter_by(**subject).delete(synchronize_session=False)
    for block in update.blocks:
        for key in block.permissions:
            db.add(AccessGrant(**subject, workspace_id=block.workspace_id, permission_key=key))
    db.commit()


def _summary(update: GrantsUpdate) -> str:
    total = sum(len(b.permissions) for b in update.blocks)
    return f"{total} permissoes em {len(update.blocks)} escopos"


@router.post("/by-email", response_model=ByEmailOut)
def grant_by_email(
    data: GrantsByEmail,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("membros.adicionar")),
):
    """Usado ao adicionar um membro: soma as permissões avulsas às que a pessoa já tem (nunca tira). Sem conta
    ainda, só aceita se houver convite pendente para o e-mail, e as permissões ficam reservadas nele."""
    workspace_ids = {b.workspace_id for b in data.blocks if b.workspace_id is not None}
    if workspace_ids:
        found = {row.id for row in db.query(Workspace.id).filter(Workspace.id.in_(workspace_ids)).all()}
        if workspace_ids - found:
            raise HTTPException(status_code=404, detail="Coleção não encontrada")

    user = db.query(User).filter(User.email == data.email).first()
    if user:
        if is_platform_admin(db, user.id):
            raise HTTPException(status_code=400, detail="Quem está no grupo Administradores já tem todas as permissões")
        have = {
            (row.workspace_id, row.permission_key)
            for row in db.query(AccessGrant).filter(AccessGrant.user_id == user.id).all()
        }
        check_can_give_keys(db, current_user, keys_by_scope_of_blocks(data.blocks))
        for block in data.blocks:
            for key in block.permissions:
                if (block.workspace_id, key) not in have:
                    db.add(AccessGrant(user_id=user.id, workspace_id=block.workspace_id, permission_key=key))
        db.commit()
        log_action(
            db,
            action="update",
            entity="user_access",
            user_id=current_user.id,
            entity_id=str(user.id),
            details=f"{user.email}: {_summary(data)}",
        )
        return ByEmailOut(status="applied")

    if db.query(GroupInvite.id).filter(GroupInvite.email == data.email).first() is None:
        raise HTTPException(status_code=400, detail="Convide a pessoa antes de reservar permissões para ela")
    check_can_give_keys(db, current_user, keys_by_scope_of_blocks(data.blocks))
    replace_pending(db, data.email, data.blocks)
    db.commit()
    log_action(
        db,
        action="update",
        entity="user_access",
        user_id=current_user.id,
        details=f"{data.email} (convite): {_summary(data)}",
    )
    return ByEmailOut(status="pending")


@router.get("/groups", response_model=GroupsGrantsOut)
def list_groups_grants(db: Session = Depends(get_db), _=Depends(require_global_permission("grupos.ver"))):
    """As permissões de todos os grupos de uma vez, para a visão por grupo da aba Membros e permissões."""
    by_group: dict[int, list[AccessGrant]] = {}
    for row in db.query(AccessGrant).filter(AccessGrant.group_id.isnot(None)).all():
        by_group.setdefault(row.group_id, []).append(row)
    groups = db.query(Group).order_by(Group.is_admin_group.desc(), Group.is_default.desc(), Group.name).all()
    return GroupsGrantsOut(
        groups=[
            GroupGrantsOut(group_id=g.id, blocks=_blocks(by_group.get(g.id, [])), editable=not g.is_admin_group)
            for g in groups
        ]
    )


@router.get("/groups/{group_id}", response_model=GrantsOut)
def get_group_grants(group_id: int, db: Session = Depends(get_db), _=Depends(require_global_permission("grupos.ver"))):
    group = db.query(Group).get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")
    rows = db.query(AccessGrant).filter(AccessGrant.group_id == group_id).all()
    return GrantsOut(blocks=_blocks(rows), editable=not group.is_admin_group)


@router.put("/groups/{group_id}", response_model=GrantsOut)
def put_group_grants(
    group_id: int,
    data: GrantsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("permissoes.editar")),
):
    group = db.query(Group).get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")
    if group.is_admin_group:
        raise HTTPException(status_code=400, detail="O grupo Administradores ja tem todas as permissoes")

    check_can_change_grants(db, current_user, current_keys_by_scope(db, {"group_id": group_id}), keys_by_scope_of_blocks(data.blocks))

    _replace(db, {"group_id": group_id}, data)
    log_action(
        db,
        action="update",
        entity="group_access",
        user_id=current_user.id,
        entity_id=str(group_id),
        details=f"{group.name}: {_summary(data)}",
    )
    rows = db.query(AccessGrant).filter(AccessGrant.group_id == group_id).all()
    return GrantsOut(blocks=_blocks(rows), editable=True)


@router.get("/users/{user_id}", response_model=GrantsOut)
def get_user_grants(user_id: int, db: Session = Depends(get_db), _=Depends(require_global_permission("membros.ver"))):
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    rows = db.query(AccessGrant).filter(AccessGrant.user_id == user_id).all()
    return GrantsOut(blocks=_blocks(rows), editable=not is_platform_admin(db, user_id))


@router.put("/users/{user_id}", response_model=GrantsOut)
def put_user_grants(
    user_id: int,
    data: GrantsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("permissoes.editar")),
):
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    if is_platform_admin(db, user_id):
        raise HTTPException(status_code=400, detail="Quem esta no grupo Administradores ja tem todas as permissoes")

    check_can_change_grants(db, current_user, current_keys_by_scope(db, {"user_id": user_id}), keys_by_scope_of_blocks(data.blocks))

    _replace(db, {"user_id": user_id}, data)
    log_action(
        db,
        action="update",
        entity="user_access",
        user_id=current_user.id,
        entity_id=str(user_id),
        details=f"{user.email}: {_summary(data)}",
    )
    rows = db.query(AccessGrant).filter(AccessGrant.user_id == user_id).all()
    return GrantsOut(blocks=_blocks(rows), editable=True)

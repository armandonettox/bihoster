from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.workspace_deps import (
    admin_group_lock,
    get_or_create_admin_group,
    get_or_create_default_group,
    require_platform_admin,
)
from app.models.invite import GroupInvite
from app.models.user import User
from app.models.workspace import Group, GroupMember, GroupWorkspaceAccess
from app.routers.auth import get_current_user
from app.schemas.workspace import GroupCreate, GroupInviteOut, GroupMemberAdd, GroupMemberOut, GroupOut, GroupUpdate

router = APIRouter(prefix="/groups", tags=["groups"])


@router.get("/", response_model=list[GroupOut])
def list_groups(db: Session = Depends(get_db), _=Depends(get_current_user)):
    get_or_create_default_group(db)  # backfill em instalacoes anteriores a esse recurso
    get_or_create_admin_group(db)
    return db.query(Group).order_by(Group.is_admin_group.desc(), Group.is_default.desc(), Group.name).all()


@router.post("/", response_model=GroupOut, status_code=status.HTTP_201_CREATED)
def create_group(
    data: GroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    group = Group(name=data.name)
    db.add(group)
    db.commit()
    db.refresh(group)

    log_action(db, action="create", entity="group", user_id=current_user.id, entity_id=group.id, details=group.name)
    return group


@router.put("/{group_id}", response_model=GroupOut)
def update_group(
    group_id: int,
    data: GroupUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    group = db.query(Group).get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")

    updates = data.model_dump(exclude_unset=True)
    if (group.is_default or group.is_admin_group) and "name" in updates and updates["name"] != group.name:
        raise HTTPException(status_code=400, detail="Esse grupo padrao nao pode ser renomeado")

    for field, value in updates.items():
        setattr(group, field, value)
    db.commit()
    db.refresh(group)
    return group


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    group = db.query(Group).get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")
    if group.is_default or group.is_admin_group:
        raise HTTPException(status_code=400, detail="Esse grupo padrao nao pode ser excluido")

    db.query(GroupWorkspaceAccess).filter(GroupWorkspaceAccess.group_id == group_id).delete()
    db.query(GroupMember).filter(GroupMember.group_id == group_id).delete()
    db.query(GroupInvite).filter(GroupInvite.group_id == group_id).delete()
    db.delete(group)
    db.commit()


@router.get("/{group_id}/members", response_model=list[GroupMemberOut])
def list_group_members(
    group_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    group = db.query(Group).get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")

    members = db.query(GroupMember).filter(GroupMember.group_id == group_id).all()
    return [GroupMemberOut(user_id=m.user.id, name=m.user.name, email=m.user.email) for m in members]


@router.post("/{group_id}/members", response_model=GroupMemberOut, status_code=status.HTTP_201_CREATED)
def add_group_member(
    group_id: int,
    data: GroupMemberAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    group = db.query(Group).get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")

    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="Nenhum usuario cadastrado com esse email")

    exists = db.query(GroupMember).filter(GroupMember.group_id == group_id, GroupMember.user_id == user.id).first()
    if exists:
        raise HTTPException(status_code=400, detail="Usuario ja esta no grupo")

    db.add(GroupMember(group_id=group_id, user_id=user.id))
    try:
        db.commit()
    except IntegrityError:
        # Duas requisicoes de adicao pro mesmo usuario+grupo passaram pela checagem acima
        # antes de qualquer commit -- a constraint unica pega a corrida em vez de dar 500.
        db.rollback()
        raise HTTPException(status_code=400, detail="Usuario ja esta no grupo")

    log_action(
        db,
        action="add_group_member",
        entity="group",
        user_id=current_user.id,
        entity_id=group_id,
        details=user.email,
    )
    return GroupMemberOut(user_id=user.id, name=user.name, email=user.email)


@router.post("/{group_id}/invite")
def invite_group_member(
    group_id: int,
    data: GroupMemberAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    """Adiciona ao grupo se o email ja tem conta; senao cria um convite pendente --
    quando a pessoa se cadastrar com esse email, ela entra automaticamente no grupo."""
    group = db.query(Group).get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")

    user = db.query(User).filter(User.email == data.email).first()
    if user:
        exists = db.query(GroupMember).filter(GroupMember.group_id == group_id, GroupMember.user_id == user.id).first()
        if exists:
            raise HTTPException(status_code=400, detail="Usuario ja esta no grupo")
        db.add(GroupMember(group_id=group_id, user_id=user.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=400, detail="Usuario ja esta no grupo")
        log_action(db, action="add_group_member", entity="group", user_id=current_user.id, entity_id=group_id, details=user.email)
        return {"status": "added", "email": user.email}

    existing_invite = db.query(GroupInvite).filter(GroupInvite.group_id == group_id, GroupInvite.email == data.email).first()
    if existing_invite:
        raise HTTPException(status_code=400, detail="Ja existe um convite pendente para esse email neste grupo")

    invite = GroupInvite(email=data.email, group_id=group_id, invited_by_id=current_user.id)
    db.add(invite)
    try:
        db.commit()
    except IntegrityError:
        # Duas requisicoes de convite pro mesmo email+grupo passaram pela checagem acima
        # antes de qualquer commit -- a constraint unica pega a corrida em vez de duplicar.
        db.rollback()
        raise HTTPException(status_code=400, detail="Ja existe um convite pendente para esse email neste grupo")

    log_action(db, action="invite_group_member", entity="group", user_id=current_user.id, entity_id=group_id, details=data.email)
    return {"status": "invited", "email": data.email}


@router.get("/{group_id}/invites", response_model=list[GroupInviteOut])
def list_group_invites(
    group_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    return db.query(GroupInvite).filter(GroupInvite.group_id == group_id).all()


@router.delete("/{group_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_group_invite(
    group_id: int,
    invite_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    invite = db.query(GroupInvite).filter(GroupInvite.id == invite_id, GroupInvite.group_id == group_id).first()
    if invite:
        db.delete(invite)
        db.commit()


@router.delete("/{group_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_group_member(
    group_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    group = db.query(Group).get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")
    if group.is_default:
        raise HTTPException(status_code=400, detail="Todo usuario cadastrado fica no grupo padrao")

    # Lock em volta da checagem + remocao -- sem isso, duas remocoes concorrentes dos 2 ultimos
    # admins podem ambas ler admins_left==2 antes de qualquer commit e esvaziar o grupo.
    with admin_group_lock:
        if group.is_admin_group:
            admins_left = db.query(GroupMember).filter(GroupMember.group_id == group_id).count()
            if admins_left <= 1:
                raise HTTPException(status_code=400, detail="Nao e possivel remover o ultimo administrador da plataforma")

        member = db.query(GroupMember).filter(GroupMember.group_id == group_id, GroupMember.user_id == user_id).first()
        if member:
            db.delete(member)
            db.commit()

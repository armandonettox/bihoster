from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import ALL_PERMISSIONS, get_user_permissions
from app.core.workspace_deps import require_platform_admin
from app.models.permission import PermissionGrant, PermissionLevel
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.permission import (
    AssignLevelIn,
    MyPermissionsOut,
    PermissionLevelCreate,
    PermissionLevelOut,
    PermissionLevelUpdate,
)

router = APIRouter(prefix="/permissions", tags=["permissions"])


def _level_to_out(level: PermissionLevel, db: Session) -> PermissionLevelOut:
    grants = [g.permission_key for g in db.query(PermissionGrant).filter(PermissionGrant.level_id == level.id).all()]
    return PermissionLevelOut(
        id=level.id,
        name=level.name,
        description=level.description,
        is_system=level.is_system,
        grants=grants,
        created_at=level.created_at,
    )


@router.get("/levels", response_model=list[PermissionLevelOut])
def list_levels(db: Session = Depends(get_db), _=Depends(require_platform_admin)):
    levels = db.query(PermissionLevel).order_by(PermissionLevel.id).all()
    return [_level_to_out(lv, db) for lv in levels]


@router.post("/levels", response_model=PermissionLevelOut, status_code=201)
def create_level(body: PermissionLevelCreate, db: Session = Depends(get_db), _=Depends(require_platform_admin)):
    for key in body.grants:
        if key not in ALL_PERMISSIONS:
            raise HTTPException(status_code=422, detail=f"Chave de permissao invalida: {key}")

    if db.query(PermissionLevel).filter(PermissionLevel.name == body.name).first():
        raise HTTPException(status_code=409, detail="Ja existe um nivel com esse nome")

    level = PermissionLevel(name=body.name, description=body.description, is_system=False)
    db.add(level)
    db.flush()
    for key in body.grants:
        db.add(PermissionGrant(level_id=level.id, permission_key=key))
    db.commit()
    db.refresh(level)
    return _level_to_out(level, db)


@router.put("/levels/{level_id}", response_model=PermissionLevelOut)
def update_level(
    level_id: int,
    body: PermissionLevelUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    level = db.query(PermissionLevel).get(level_id)
    if not level:
        raise HTTPException(status_code=404, detail="Nivel nao encontrado")

    if body.name is not None:
        if body.name != level.name and db.query(PermissionLevel).filter(PermissionLevel.name == body.name).first():
            raise HTTPException(status_code=409, detail="Ja existe um nivel com esse nome")
        level.name = body.name

    if body.description is not None:
        level.description = body.description

    if body.grants is not None:
        for key in body.grants:
            if key not in ALL_PERMISSIONS:
                raise HTTPException(status_code=422, detail=f"Chave de permissao invalida: {key}")
        db.query(PermissionGrant).filter(PermissionGrant.level_id == level.id).delete()
        for key in body.grants:
            db.add(PermissionGrant(level_id=level.id, permission_key=key))

    db.commit()
    db.refresh(level)
    return _level_to_out(level, db)


@router.delete("/levels/{level_id}", status_code=204)
def delete_level(level_id: int, db: Session = Depends(get_db), _=Depends(require_platform_admin)):
    level = db.query(PermissionLevel).get(level_id)
    if not level:
        raise HTTPException(status_code=404, detail="Nivel nao encontrado")
    if level.is_system:
        raise HTTPException(status_code=400, detail="Niveis do sistema nao podem ser excluidos")

    # Remove o nivel dos usuarios que o usavam
    db.query(User).filter(User.permission_level_id == level.id).update(
        {"permission_level_id": None}, synchronize_session=False
    )
    db.query(PermissionGrant).filter(PermissionGrant.level_id == level.id).delete()
    db.delete(level)
    db.commit()


@router.put("/users/{user_id}/level", response_model=dict)
def assign_level(
    user_id: int,
    body: AssignLevelIn,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")

    if body.permission_level_id is not None:
        level = db.query(PermissionLevel).get(body.permission_level_id)
        if not level:
            raise HTTPException(status_code=404, detail="Nivel de permissao nao encontrado")

    user.permission_level_id = body.permission_level_id
    db.commit()
    return {"ok": True}


@router.get("/me", response_model=MyPermissionsOut)
def my_permissions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    perms = get_user_permissions(db, current_user.id)
    level_name: Optional[str] = None
    if current_user.permission_level_id:
        level = db.query(PermissionLevel).get(current_user.permission_level_id)
        level_name = level.name if level else None
    return MyPermissionsOut(
        permission_level_id=current_user.permission_level_id,
        permission_level_name=level_name,
        permissions=sorted(perms),
    )

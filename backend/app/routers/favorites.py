from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.workspace_deps import get_effective_role, get_effective_roles_map
from app.models.favorite import Favorite
from app.models.report import Report
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.report import ReportOut

router = APIRouter(prefix="/favorites", tags=["favorites"])


@router.get("/", response_model=list[ReportOut])
def list_favorites(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """So retorna favoritos cujas colecoes o usuario ainda tem acesso -- evita vazar
    nome/metadado de um relatorio depois que o acesso a colecao foi revogado."""
    reports = (
        db.query(Report)
        .join(Favorite, Favorite.report_id == Report.id)
        .filter(Favorite.user_id == current_user.id)
        .all()
    )
    accessible_workspace_ids = set(get_effective_roles_map(db, current_user.id).keys())
    return [r for r in reports if r.collection_id in accessible_workspace_ids]


@router.post("/{report_id}", status_code=status.HTTP_201_CREATED)
def add_favorite(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    report = db.query(Report).get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")
    if get_effective_role(db, current_user.id, report.collection_id) is None:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")

    exists = (
        db.query(Favorite)
        .filter(Favorite.user_id == current_user.id, Favorite.report_id == report_id)
        .first()
    )
    if exists:
        return {"detail": "Ja esta nos favoritos"}

    db.add(Favorite(user_id=current_user.id, report_id=report_id))
    db.commit()
    return {"detail": "Adicionado aos favoritos"}


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_favorite(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    favorite = (
        db.query(Favorite)
        .filter(Favorite.user_id == current_user.id, Favorite.report_id == report_id)
        .first()
    )
    if favorite:
        db.delete(favorite)
        db.commit()

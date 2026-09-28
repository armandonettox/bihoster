from fastapi import HTTPException
from sqlalchemy.orm import Session


def get_or_404(db: Session, model, detail: str, **filters):
    """Busca uma entidade por filtros exatos ou levanta 404 -- substitui as varias funcoes
    `_get_X_or_404` reimplementadas em cada router (mesma logica, entidades diferentes)."""
    obj = db.query(model).filter_by(**filters).first()
    if not obj:
        raise HTTPException(status_code=404, detail=detail)
    return obj

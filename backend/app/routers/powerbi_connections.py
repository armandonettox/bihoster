from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import powerbi
from app.core.database import get_db
from app.core.workspace_deps import require_platform_admin
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.routers import powerbi as embed_router
from app.routers.powerbi_catalog import invalidate_catalog_cache
from app.schemas.powerbi_connection import (
    PowerBIConnectionCreate,
    PowerBIConnectionOut,
    PowerBIConnectionUpdate,
)

router = APIRouter(prefix="/powerbi-connections", tags=["powerbi-connections"])


def _invalidate_connection_caches(db: Session, connection_id: int) -> None:
    """Limpa todos os caches derivados de uma conta: token do Azure AD, catalogo do Power BI e,
    pros relatorios que usam a conta, embed token e info de atualizacao."""
    powerbi.invalidate_token_cache(connection_id)
    invalidate_catalog_cache(connection_id)
    for report in db.query(Report).filter(Report.powerbi_connection_id == connection_id).all():
        embed_router.invalidate_embed_cache(report.collection_id, report.id)


def _to_out(connection: PowerBIConnection) -> PowerBIConnectionOut:
    return PowerBIConnectionOut(
        id=connection.id,
        name=connection.name,
        tenant_id=connection.tenant_id,
        client_id=connection.client_id,
        client_secret_configured=bool(connection.client_secret),
    )


@router.get("/", response_model=list[PowerBIConnectionOut])
def list_connections(db: Session = Depends(get_db), _=Depends(require_platform_admin)):
    connections = db.query(PowerBIConnection).order_by(PowerBIConnection.name).all()
    return [_to_out(c) for c in connections]


@router.post("/", response_model=PowerBIConnectionOut, status_code=status.HTTP_201_CREATED)
def create_connection(
    data: PowerBIConnectionCreate, db: Session = Depends(get_db), _=Depends(require_platform_admin)
):
    connection = PowerBIConnection(**data.model_dump())
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return _to_out(connection)


@router.put("/{connection_id}", response_model=PowerBIConnectionOut)
def update_connection(
    connection_id: int,
    data: PowerBIConnectionUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    connection = db.query(PowerBIConnection).get(connection_id)
    if not connection:
        raise HTTPException(status_code=404, detail="Conta do Power BI nao encontrada")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(connection, field, value)
    db.commit()
    db.refresh(connection)
    # Credenciais/tenant podem ter mudado -- descarta tudo que foi derivado da conta antiga:
    # token do Azure AD, catalogo (workspaces/relatorios/paginas) e, pros relatorios que usam
    # essa conta, o embed token e a info de atualizacao em cache.
    _invalidate_connection_caches(db, connection_id)
    return _to_out(connection)


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(connection_id: int, db: Session = Depends(get_db), _=Depends(require_platform_admin)):
    connection = db.query(PowerBIConnection).get(connection_id)
    if not connection:
        raise HTTPException(status_code=404, detail="Conta do Power BI nao encontrada")
    in_use = db.query(Report).filter(Report.powerbi_connection_id == connection_id).count()
    if in_use:
        raise HTTPException(
            status_code=400,
            detail=f"Essa conta esta em uso por {in_use} relatorio(s) -- edite ou exclua esses relatorios primeiro",
        )
    db.delete(connection)
    try:
        db.commit()
    except IntegrityError:
        # Um relatorio pode ter passado a referenciar essa conta entre a checagem acima e o commit
        # (corrida) -- com FK habilitada no SQLite, o banco recusa em vez de deixar orfao.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Um relatorio passou a usar essa conta enquanto ela era excluida -- tente novamente",
        )
    _invalidate_connection_caches(db, connection_id)

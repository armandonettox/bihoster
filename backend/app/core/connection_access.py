"""Permissao por conta do Power BI: gravar e conferir o que um grupo ou uma pessoa pode numa conta so.

Espelha core/dataset_access.py. Quem mexe: o administrador ou quem tem `permissoes.editar`, e sempre so com o que ja tem
naquela conta (a permissao geral vale em todas). Nao ha item de "compartilhar" por conta: dar acesso a uma conta e coisa de
quem administra permissoes."""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core import access_catalog
from app.core.access_catalog import CONNECTION_CAPABLE
from app.core.access_engine import EffectiveAccess, effective_access
from app.models.connection_grant import ConnectionGrant
from app.models.powerbi_connection import PowerBIConnection
from app.models.user import User

GROUP = "group_id"
USER = "user_id"


def validate_keys(keys: list[str]) -> list[str]:
    unknown = [key for key in keys if key not in CONNECTION_CAPABLE]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Permissao que nao vale numa conta: {', '.join(sorted(set(unknown)))}")
    return sorted(set(keys))


def with_dependents(keys: set[str]) -> set[str]:
    return set(keys)


def can_manage(access: EffectiveAccess, connection_id: int) -> bool:
    return access.is_admin or access.has_global("permissoes.editar")


def require_can_manage(db: Session, actor: User, connection: PowerBIConnection) -> EffectiveAccess:
    access = effective_access(db, actor.id)
    if not can_manage(access, connection.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Voce nao pode mudar os acessos desta conta")
    return access


def check_can_change(access: EffectiveAccess, connection_id: int, changed: set[str]) -> None:
    """Tudo o que entra ou sai precisa ser algo que quem faz a mudanca tem nesta conta."""
    if access.is_admin:
        return
    missing = sorted(key for key in changed if not access.has_in_connection(key, connection_id))
    if missing:
        labels = ", ".join(dict.fromkeys(access_catalog.get(key).label if access_catalog.get(key) else key for key in missing))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Voce so pode dar ou tirar permissoes que voce mesmo tem nesta conta. Faltam: {labels}",
        )


def subject_keys(db: Session, connection_id: int, subject: str, subject_id: int) -> set[str]:
    rows = db.query(ConnectionGrant.permission_key).filter(ConnectionGrant.connection_id == connection_id, getattr(ConnectionGrant, subject) == subject_id).all()
    return {row[0] for row in rows}


def set_subject_keys(db: Session, connection_id: int, subject: str, subject_id: int, keys: set[str]) -> tuple[set[str], set[str]]:
    """Deixa o grupo ou a pessoa com exatamente `keys` nesta conta. Devolve (antes, depois). Quem chama faz o commit."""
    rows = db.query(ConnectionGrant).filter(ConnectionGrant.connection_id == connection_id, getattr(ConnectionGrant, subject) == subject_id).all()
    before = {row.permission_key for row in rows}
    for row in rows:
        if row.permission_key not in keys:
            db.delete(row)
    for key in keys - before:
        db.add(ConnectionGrant(connection_id=connection_id, permission_key=key, **{subject: subject_id}))
    return before, set(keys)

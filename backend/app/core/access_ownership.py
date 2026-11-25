"""Assinaturas e alertas tem dono (quem criou). Cada acao tem duas permissoes: a simples vale para o que a propria pessoa
criou e a "-outras" vale para o que outras pessoas criaram. Item sem dono (a pessoa que criou foi removida) conta como de
outra pessoa. A permissao "-outras" sempre exige tambem a simples (ver o catalogo), entao quem edita o de outros tambem
pode editar o seu."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.access_catalog import OWN_TO_OTHERS
from app.core.access_engine import can_in_workspace, effective_access, folders_of_report
from app.models.user import User


def is_own(user: User, created_by_id: int | None) -> bool:
    return created_by_id is not None and created_by_id == user.id


def key_for(user: User, created_by_id: int | None, own_key: str) -> str:
    """A permissao que vale para este item: a simples se e da pessoa, a "-outras" se e de outra."""
    return own_key if is_own(user, created_by_id) else OWN_TO_OTHERS[own_key]


def can_in_report(db: Session, user: User, report, key: str) -> bool:
    """O item vale neste relatorio: dado direto nele, vindo de uma pasta em que ele esta, ou herdado (so soma)."""
    access = effective_access(db, user.id)
    return access.has_in_report(key, report.id, report.collection_id, folders_of_report(db, report.id))


def can_act(db: Session, user: User, workspace_id: int, created_by_id: int | None, own_key: str, report=None) -> bool:
    """Com `report`, vale o que a pessoa tem NAQUELE relatorio (permissao por relatorio); sem ele, o que tem na colecao."""
    if report is not None:
        if not can_in_report(db, user, report, own_key):
            return False
        return is_own(user, created_by_id) or can_in_report(db, user, report, OWN_TO_OTHERS[own_key])
    if not can_in_workspace(db, user.id, own_key, workspace_id):
        return False
    return is_own(user, created_by_id) or can_in_workspace(db, user.id, OWN_TO_OTHERS[own_key], workspace_id)


def require_can_act(
    db: Session, user: User, workspace_id: int, created_by_id: int | None, own_key: str, message: str, report=None
) -> None:
    if not can_act(db, user, workspace_id, created_by_id, own_key, report):
        raise HTTPException(status_code=403, detail=message)

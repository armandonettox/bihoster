import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.analytics_access import analytics_permissions, require_analytics_view
from app.core.audit_dashboard import GRID_COLUMNS, DashboardLayout, DashboardWidget, default_widgets, required_permissions
from app.core.permission_keys import ANALYTICS_CREATE, ANALYTICS_DELETE, ANALYTICS_EDIT
from app.routers.auth import get_current_user
from app.core.database import get_db
from app.models.audit_dashboard import AuditDashboard
from app.models.user import User
from app.schemas.types import UtcDatetime

router = APIRouter(prefix="/audit/dashboard", tags=["audit"])

DASHBOARD_ID = 1
_ACTION_NAMES = {ANALYTICS_CREATE: "criar", ANALYTICS_EDIT: "editar", ANALYTICS_DELETE: "excluir"}


class DashboardOut(BaseModel):
    widgets: list[DashboardWidget]
    columns: int = GRID_COLUMNS
    # True enquanto ninguem salvou um layout proprio (vale o padrao)
    is_default: bool
    updated_at: Optional[UtcDatetime] = None
    updated_by: Optional[str] = None


def _stored(db: Session) -> Optional[AuditDashboard]:
    return db.query(AuditDashboard).filter(AuditDashboard.id == DASHBOARD_ID).first()


def _out(row: Optional[AuditDashboard]) -> DashboardOut:
    if row is not None:
        try:
            layout = DashboardLayout.model_validate(json.loads(row.layout))
            return DashboardOut(
                widgets=layout.widgets, is_default=False, updated_at=row.updated_at, updated_by=row.updated_by_email
            )
        except ValueError:
            pass  # layout salvo que ficou invalido (ex: uma fonte removida numa versao nova): volta ao padrao
    return DashboardOut(widgets=[DashboardWidget(**w) for w in default_widgets()], is_default=True)


@router.get("", response_model=DashboardOut)
def get_dashboard(db: Session = Depends(get_db), _=Depends(require_analytics_view)):
    return _out(_stored(db))


@router.put("", response_model=DashboardOut)
def save_dashboard(
    data: DashboardLayout,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Guarda o layout do painel, o mesmo para todo mundo. O servidor valida posicao, tamanho
    e a fonte de cada visual, entao um cliente com defeito nao consegue gravar um painel quebrado."""
    row = _stored(db)
    granted = analytics_permissions(db, current_user.id)
    needed = required_permissions(
        [w.model_dump() for w in _out(row).widgets], [w.model_dump() for w in data.widgets]
    )
    for key in (ANALYTICS_CREATE, ANALYTICS_EDIT, ANALYTICS_DELETE):
        if key in needed and key not in granted:
            raise HTTPException(status_code=403, detail=f"Voce nao tem permissao para {_ACTION_NAMES[key]} visuais do painel.")
    if not needed:
        return _out(row)
    payload = json.dumps(data.model_dump(), ensure_ascii=False)
    if row is None:
        row = AuditDashboard(id=DASHBOARD_ID, layout=payload)
        db.add(row)
    else:
        row.layout = payload
    row.updated_by_id = current_user.id
    row.updated_by_email = current_user.email
    db.commit()
    db.refresh(row)
    log_action(
        db,
        action="update_dashboard",
        entity="dashboard",
        user_id=current_user.id,
        details=f"{len(data.widgets)} visuais",
    )
    return _out(row)


@router.delete("", response_model=DashboardOut)
def reset_dashboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Volta ao painel padrao. Pode criar, editar e excluir visuais de uma vez, entao pede as tres permissoes."""
    granted = analytics_permissions(db, current_user.id)
    if not {ANALYTICS_CREATE, ANALYTICS_EDIT, ANALYTICS_DELETE} <= granted:
        raise HTTPException(status_code=403, detail="Voce nao tem permissao para restaurar o painel padrao.")
    row = _stored(db)
    if row is not None:
        db.delete(row)
        db.commit()
        log_action(db, action="reset_dashboard", entity="dashboard", user_id=current_user.id)
    return _out(None)

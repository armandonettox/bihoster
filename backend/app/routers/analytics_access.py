from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.analytics_access import analytics_permissions
from app.core.database import get_db
from app.core.permission_keys import ANALYTICS_CREATE, ANALYTICS_DELETE, ANALYTICS_EDIT, ANALYTICS_VIEW
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.group_permission import AnalyticsAccessOut

router = APIRouter(prefix="/analytics", tags=["analytics-access"])


@router.get("/access", response_model=AnalyticsAccessOut)
def get_analytics_access(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """O que a pessoa logada pode fazer nos analiticos. A tela usa para mostrar ou esconder
    botoes; quem manda de verdade e o servidor, em cada rota."""
    granted = analytics_permissions(db, current_user.id)
    return AnalyticsAccessOut(
        can_view=ANALYTICS_VIEW in granted,
        can_create=ANALYTICS_CREATE in granted,
        can_edit=ANALYTICS_EDIT in granted,
        can_delete=ANALYTICS_DELETE in granted,
    )

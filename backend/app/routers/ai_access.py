from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.ai_access import AI_MANAGE, AI_USE, ai_permissions
from app.core.database import get_db
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.group_permission import AIAccessOut

router = APIRouter(prefix="/ai", tags=["ai-access"])


@router.get("/access", response_model=AIAccessOut)
def get_ai_access(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """O que a pessoa logada pode fazer com a IA. A tela usa para mostrar ou esconder a aba de
    configuracao e o chat; quem manda de verdade e o servidor, em cada rota."""
    granted = ai_permissions(db, current_user.id)
    return AIAccessOut(can_manage=AI_MANAGE in granted, can_use=AI_USE in granted)

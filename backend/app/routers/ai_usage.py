from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core import ai_usage
from app.core.ai_access import require_ai_manage
from app.core.database import get_db
from app.models.user import User
from app.schemas.ai_usage import UsageOut

router = APIRouter(prefix="/ai/usage", tags=["ai-usage"])


@router.get("/", response_model=UsageOut)
def get_ai_usage(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    _: User = Depends(require_ai_manage),
):
    """Consumo da IA nos ultimos `days` dias, por pessoa e por modelo, e a situacao do orcamento do
    mes. So para quem gerencia a IA. Nao traz texto de conversa."""
    return ai_usage.summarize(db, days)

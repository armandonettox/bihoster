from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core import ai_options
from app.core.ai_access import require_ai_manage
from app.core.audit import log_action
from app.core.database import get_db
from app.models.user import User
from app.schemas.ai_options import AIOptionsOut, AIOptionsUpdate

router = APIRouter(prefix="/ai/options", tags=["ai-options"])


def _to_out(db: Session) -> AIOptionsOut:
    return AIOptionsOut(
        retention_days=ai_options.retention_days(db),
        daily_question_limit=ai_options.daily_question_limit(db),
        openrouter_monthly_budget_usd=ai_options.openrouter_monthly_budget(db),
    )


@router.get("/", response_model=AIOptionsOut)
def get_ai_options(db: Session = Depends(get_db), _: User = Depends(require_ai_manage)):
    return _to_out(db)


@router.put("/", response_model=AIOptionsOut)
def update_ai_options(
    data: AIOptionsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ai_manage),
):
    row = ai_options.get_settings_row(db)
    changed = {name: value for name, value in data.model_dump(exclude_unset=True).items() if value is not None}
    if "retention_days" in changed:
        row.ai_retention_days = changed["retention_days"]
    if "daily_question_limit" in changed:
        row.ai_daily_question_limit = changed["daily_question_limit"]
    if "openrouter_monthly_budget_usd" in changed:
        row.ai_openrouter_monthly_budget = changed["openrouter_monthly_budget_usd"]
    db.commit()

    log_action(
        db,
        action="update_ai_options",
        entity="settings",
        user_id=current_user.id,
        details=", ".join(f"{name}={value}" for name, value in sorted(changed.items())),
    )
    return _to_out(db)

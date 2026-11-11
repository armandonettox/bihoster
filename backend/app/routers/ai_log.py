from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core import chat_log
from app.core.ai_access import require_ai_manage
from app.core.audit import log_action
from app.core.database import get_db
from app.models.user import User
from app.schemas.ai_log import AILogEntryOut, AILogModelStats, AILogOut

router = APIRouter(prefix="/ai/log", tags=["ai-log"])


def _entry_out(row) -> AILogEntryOut:
    return AILogEntryOut(
        id=row.id,
        created_at=row.created_at,
        user_email=row.user_email,
        conversation_id=row.conversation_id,
        provider=row.provider,
        model=row.model,
        report_name=row.report_name,
        outcome=row.outcome,
        error=row.error,
        duration_ms=row.duration_ms or 0,
        llm_calls=row.llm_calls or 0,
        input_tokens=row.input_tokens or 0,
        output_tokens=row.output_tokens or 0,
        used_image=bool(row.used_image),
        question=row.question,
        reply=row.reply,
        dax=row.dax,
        steps=chat_log.parse_steps(row.steps_json),
    )


@router.get("/", response_model=AILogOut)
def get_ai_log(
    days: int = Query(7, ge=1, le=chat_log.LOG_RETENTION_DAYS),
    only_problems: bool = False,
    provider: Optional[str] = Query(None, max_length=50),
    model: Optional[str] = Query(None, max_length=200),
    before_id: Optional[int] = Query(None, ge=1),
    limit: int = Query(chat_log.PAGE_SIZE, ge=1, le=chat_log.MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ai_manage),
):
    """O que as pessoas perguntaram ao chat e o que a IA respondeu, com provedor, modelo, tempo e desfecho, para o
    admin achar respostas ruins. So quem gerencia a IA. Tem a pergunta e a resposta em texto (nunca as linhas das
    tabelas) e se apaga sozinho depois de 30 dias. Cada consulta fica na auditoria."""
    rows, next_before_id = chat_log.list_entries(db, days, only_problems, provider, model, before_id, limit)
    # So na primeira pagina: "carregar mais" nao precisa de uma entrada de auditoria por clique
    if before_id is None:
        log_action(
            db,
            action="view_ai_log",
            entity="settings",
            user_id=current_user.id,
            details=f"dias={days}; so_problemas={'sim' if only_problems else 'nao'}",
        )
    return AILogOut(
        days=days,
        retention_days=chat_log.LOG_RETENTION_DAYS,
        entries=[_entry_out(row) for row in rows],
        next_before_id=next_before_id,
        by_model=[AILogModelStats(**stat) for stat in chat_log.summarize(db, days)],
    )

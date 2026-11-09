from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core import chat_engine
from app.core.ai_access import require_ai_use
from app.core.ai_providers import AIError
from app.core.audit import log_action
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models.user import User
from app.schemas.ai_chat import ChatIn, ChatOut, ChatReportOut, ChatTableOut, ChatUsageOut

router = APIRouter(prefix="/ai", tags=["ai-chat"])


@router.post("/chat", response_model=ChatOut)
@limiter.limit("30/minute")
def chat(
    request: Request,
    data: ChatIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ai_use),
):
    """Responde uma pergunta sobre os dados dos relatorios que a pessoa pode ver. Exige a permissao
    "Usar chat de IA". Falha do Power BI sobe pelo tratador global (502)."""
    messages = [{"role": m.role, "content": m.content} for m in data.messages]
    try:
        answer = chat_engine.answer_question(db, current_user.id, messages, data.report_id)
    except chat_engine.ChatUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except (AIError, chat_engine.ChatEngineError) as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    # So o resumo: o texto da pergunta e da resposta pode ter dado de beneficiario e nao vai para a auditoria
    log_action(
        db,
        action="ai_chat",
        entity="report",
        user_id=current_user.id,
        entity_id=answer.report.id if answer.report else None,
        details=(
            f"{answer.provider} {answer.model}; {answer.llm_calls} chamadas; "
            f"{answer.input_tokens} tokens de entrada e {answer.output_tokens} de saida"
        ),
    )

    table = answer.table
    return ChatOut(
        reply=answer.reply,
        report=ChatReportOut(id=answer.report.id, name=answer.report.name) if answer.report else None,
        dax=answer.dax,
        table=(
            ChatTableOut(columns=table.columns, rows=table.rows, total_rows=table.total_rows, truncated=table.truncated)
            if table
            else None
        ),
        usage=ChatUsageOut(
            provider=answer.provider,
            model=answer.model,
            llm_calls=answer.llm_calls,
            input_tokens=answer.input_tokens,
            output_tokens=answer.output_tokens,
        ),
    )

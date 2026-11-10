from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core import ai_pricing, ai_usage, chat_engine, chat_history
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
    """Responde uma pergunta sobre os dados dos relatorios que a pessoa pode ver e guarda a conversa
    no historico dela. Exige a permissao "Usar chat de IA". Falha do Power BI sobe pelo tratador global (502)."""
    conversation = None
    history: list[dict] = []
    if data.conversation_id is not None:
        conversation = chat_history.get_conversation(db, current_user.id, data.conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversa nao encontrada")
        if chat_history.count_messages(db, conversation) >= chat_history.MAX_CONVERSATION_MESSAGES:
            raise HTTPException(status_code=400, detail="Esta conversa ficou longa demais. Comece uma nova.")
        history = chat_history.history_for_engine(db, conversation)

    # Limite de perguntas por dia e orcamento do mes, antes de gastar uma chamada a IA
    try:
        provider = chat_engine.resolve_chat_provider(db)
    except chat_engine.ChatUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    try:
        ai_usage.check_limits(db, current_user.id, provider.provider)
    except ai_usage.LimitReached as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    messages = [*history, {"role": "user", "content": data.message}]
    open_page = None
    if data.open_page is not None:
        open_page = chat_engine.OpenPage(
            report_id=data.open_page.report_id,
            page_name=data.open_page.page_name,
            page_title=data.open_page.page_title,
            visuals=tuple(
                chat_engine.PageVisual(title=v.title, kind=v.type, fields=tuple(v.fields)) for v in data.open_page.visuals
            ),
        )
    try:
        answer = chat_engine.answer_question(
            db, current_user.id, messages, conversation.last_report_id if conversation else None, open_page
        )
    except chat_engine.ChatUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except (AIError, chat_engine.ChatEngineError) as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    # So guarda depois de a resposta existir: erro no meio nao deixa pergunta solta no historico
    if conversation is None:
        conversation = chat_history.start_conversation(db, current_user.id, data.message)
    chat_history.save_exchange(db, conversation, data.message, answer)

    # Conta como pergunta so quando a IA foi chamada: bloqueio e recusa sem chamada nao gastam a cota
    cost = None
    if answer.llm_calls > 0:
        cost = ai_pricing.cost_usd(answer.provider, answer.model, answer.input_tokens, answer.output_tokens)
        ai_usage.record(db, current_user, answer, cost)

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
            + ("; com imagem da pagina" if answer.used_image else "")
        ),
    )

    table = answer.table
    return ChatOut(
        conversation_id=conversation.id,
        conversation_title=conversation.title,
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
            cost_usd=cost,
        ),
        used_image=answer.used_image,
    )

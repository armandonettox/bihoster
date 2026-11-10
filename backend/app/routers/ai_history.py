from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core import chat_history
from app.core.ai_access import require_ai_use
from app.core.audit import log_action
from app.core.database import get_db
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.ai_chat import ConversationDetailOut, ConversationOut, ChatReportOut, MessageOut

router = APIRouter(prefix="/ai/conversations", tags=["ai-history"])


def _get_own_or_404(db: Session, user: User, conversation_id: int):
    conversation = chat_history.get_conversation(db, user.id, conversation_id)
    if conversation is None:
        # Mesma resposta para "nao existe" e "e de outra pessoa"
        raise HTTPException(status_code=404, detail="Conversa nao encontrada")
    return conversation


@router.get("/", response_model=list[ConversationOut])
def list_my_conversations(db: Session = Depends(get_db), current_user: User = Depends(require_ai_use)):
    return chat_history.list_conversations(db, current_user.id)


@router.get("/{conversation_id}", response_model=ConversationDetailOut)
def get_my_conversation(
    conversation_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_ai_use)
):
    conversation = _get_own_or_404(db, current_user, conversation_id)
    messages = [
        MessageOut(
            id=m.id,
            role=m.role,
            content=m.content,
            report=ChatReportOut(id=m.report_id, name=m.report_name or "") if m.report_id is not None else None,
            dax=m.dax,
            created_at=m.created_at,
        )
        for m in chat_history.list_messages(db, conversation)
    ]
    return ConversationDetailOut(
        id=conversation.id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        messages=messages,
    )


# Apagar o proprio historico so exige estar logado: a pessoa pode ter perdido a permissao de usar o
# chat e ainda assim tem o direito de apagar o que e dela.
@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_conversation(
    conversation_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    conversation = _get_own_or_404(db, current_user, conversation_id)
    chat_history.delete_conversation(db, conversation)
    log_action(db, action="delete_ai_conversation", entity="ai_conversation", user_id=current_user.id, entity_id=conversation_id)


@router.delete("/", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_my_conversations(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    removed = chat_history.delete_user_history(db, current_user.id)
    log_action(
        db,
        action="delete_all_ai_conversations",
        entity="ai_conversation",
        user_id=current_user.id,
        details=f"{removed} conversas",
    )

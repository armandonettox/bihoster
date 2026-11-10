"""Historico do chat de IA: cada pessoa ve e apaga so as proprias conversas, e o que passa do prazo
de retencao e apagado sozinho. As linhas de tabela nunca sao guardadas (ver models/ai_conversation.py)."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.core import ai_options
from app.models.ai_conversation import AIConversation, AIMessage

MAX_CONVERSATION_MESSAGES = 100
HISTORY_FOR_ENGINE = 20  # ultimas mensagens lidas ao continuar uma conversa
TITLE_MAX_CHARS = 60
LIST_LIMIT = 100


def _now() -> datetime:
    return datetime.now(timezone.utc)


def make_title(question: str) -> str:
    text = " ".join(question.split())
    return text if len(text) <= TITLE_MAX_CHARS else text[: TITLE_MAX_CHARS - 3].rstrip() + "..."


def get_conversation(db: Session, user_id: int, conversation_id: int) -> Optional[AIConversation]:
    """So devolve a conversa se ela for da pessoa: de outra pessoa, e como se nao existisse."""
    return (
        db.query(AIConversation)
        .filter(AIConversation.id == conversation_id, AIConversation.user_id == user_id)
        .first()
    )


def count_messages(db: Session, conversation: AIConversation) -> int:
    return db.query(AIMessage).filter(AIMessage.conversation_id == conversation.id).count()


def list_messages(db: Session, conversation: AIConversation) -> list[AIMessage]:
    return (
        db.query(AIMessage)
        .filter(AIMessage.conversation_id == conversation.id)
        .order_by(AIMessage.id)
        .all()
    )


def history_for_engine(db: Session, conversation: AIConversation) -> list[dict]:
    """Ultimas mensagens da conversa no formato do motor (role e content)."""
    rows = (
        db.query(AIMessage)
        .filter(AIMessage.conversation_id == conversation.id)
        .order_by(AIMessage.id.desc())
        .limit(HISTORY_FOR_ENGINE)
        .all()
    )
    return [{"role": row.role, "content": row.content} for row in reversed(rows)]


def start_conversation(db: Session, user_id: int, first_question: str) -> AIConversation:
    now = _now()
    conversation = AIConversation(user_id=user_id, title=make_title(first_question), created_at=now, updated_at=now)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


def save_exchange(db: Session, conversation: AIConversation, question: str, answer) -> None:
    """Guarda a pergunta e a resposta juntas, de uma vez: erro no meio da resposta nao deixa
    uma pergunta solta. `answer` e um chat_engine.ChatAnswer; a tabela dele NAO e guardada."""
    now = _now()
    report = answer.report
    db.add(AIMessage(conversation_id=conversation.id, role="user", content=question, created_at=now))
    db.add(
        AIMessage(
            conversation_id=conversation.id,
            role="assistant",
            content=answer.reply,
            report_id=report.id if report else None,
            report_name=report.name if report else None,
            dax=answer.dax,
            created_at=now,
        )
    )
    if report:
        conversation.last_report_id = report.id
    conversation.updated_at = now
    db.commit()


def list_conversations(db: Session, user_id: int) -> list[AIConversation]:
    return (
        db.query(AIConversation)
        .filter(AIConversation.user_id == user_id)
        .order_by(AIConversation.updated_at.desc(), AIConversation.id.desc())
        .limit(LIST_LIMIT)
        .all()
    )


def _delete_by_ids(db: Session, conversation_ids: list[int]) -> None:
    if not conversation_ids:
        return
    db.query(AIMessage).filter(AIMessage.conversation_id.in_(conversation_ids)).delete(synchronize_session=False)
    db.query(AIConversation).filter(AIConversation.id.in_(conversation_ids)).delete(synchronize_session=False)


def delete_conversation(db: Session, conversation: AIConversation) -> None:
    _delete_by_ids(db, [conversation.id])
    db.commit()


def delete_user_history(db: Session, user_id: int, commit: bool = True) -> int:
    """Apaga todas as conversas da pessoa e devolve quantas eram. Quem apaga a conta inteira passa
    commit=False para tudo sair numa transacao so."""
    ids = [row.id for row in db.query(AIConversation.id).filter(AIConversation.user_id == user_id).all()]
    _delete_by_ids(db, ids)
    if commit:
        db.commit()
    return len(ids)


def purge_expired(db: Session, now: Optional[datetime] = None) -> int:
    """Apaga as conversas sem mensagem nova ha mais que o prazo de retencao. Devolve quantas."""
    cutoff = (now or _now()) - timedelta(days=ai_options.retention_days(db))
    ids = [row.id for row in db.query(AIConversation.id).filter(AIConversation.updated_at < cutoff).all()]
    _delete_by_ids(db, ids)
    db.commit()
    return len(ids)

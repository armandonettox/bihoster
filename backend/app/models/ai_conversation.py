from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func

from app.core.database import Base


class AIConversation(Base):
    """Uma conversa do chat de IA, de uma pessoa so. Cada um ve apenas as proprias (ver
    core/chat_history.py). Tabela nova: o create_all() cria sozinho."""

    __tablename__ = "ai_conversations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    # Relatorio da ultima resposta: a conversa segue com ele, a menos que a pergunta mude de assunto.
    # Sem chave estrangeira de proposito: o relatorio pode ser apagado e a conversa continua legivel.
    last_report_id = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Dia da ultima mensagem; a retencao conta a partir dele
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class AIMessage(Base):
    """Mensagem de uma conversa. Guarda o texto, o relatorio e o DAX, mas NUNCA as linhas da tabela:
    elas podem trazer dado de beneficiario e se refazem rodando o DAX de novo."""

    __tablename__ = "ai_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("ai_conversations.id"), nullable=False, index=True)
    role = Column(String, nullable=False)  # "user" ou "assistant"
    content = Column(Text, nullable=False)
    report_id = Column(Integer, nullable=True)
    report_name = Column(String, nullable=True)  # copia do nome: continua certo se o relatorio for renomeado ou apagado
    dax = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

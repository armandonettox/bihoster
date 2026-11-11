from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text

from app.core.database import Base


class AIChatLog(Base):
    """Registro de cada pergunta feita ao chat de IA, para o admin ver o que foi perguntado, o que a IA
    respondeu, qual provedor e modelo foram usados, quanto tempo cada passo levou e onde falhou. Fica separado
    do historico de cada pessoa (que ela apaga quando quiser): este registro e do admin e se apaga sozinho
    depois de LOG_RETENTION_DAYS. Guarda a pergunta, a resposta e a consulta (cortadas), nunca as linhas da
    tabela. Sem chave estrangeira para usuario nem conversa: excluir um deles nao mexe aqui. Tabela nova: o
    create_all() cria sozinho."""

    __tablename__ = "ai_chat_log"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, index=True)
    user_id = Column(Integer, nullable=True, index=True)
    user_email = Column(String, nullable=True)
    conversation_id = Column(Integer, nullable=True)
    provider = Column(String, nullable=False)
    model = Column(String, nullable=False)
    report_id = Column(Integer, nullable=True)
    report_name = Column(String, nullable=True)
    # answered, empty_answer, model_reply, off_topic, needs_detail, blocked, no_dax, no_report, no_reports ou error
    outcome = Column(String, nullable=False, index=True)
    error = Column(Text, nullable=True)
    duration_ms = Column(Integer, nullable=False, default=0)
    llm_calls = Column(Integer, nullable=False, default=0)
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    used_image = Column(Boolean, nullable=True)
    question = Column(Text, nullable=True)
    reply = Column(Text, nullable=True)
    dax = Column(Text, nullable=True)
    # Lista em JSON com cada passo: nome, tempo, tokens, motivo da parada (ver chat_engine._LLM)
    steps_json = Column(Text, nullable=True)

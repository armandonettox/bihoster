from sqlalchemy import Column, DateTime, Float, Integer, String

from app.core.database import Base


class AIUsage(Base):
    """Uma pergunta respondida pela IA: quem, quando, qual provedor e modelo, quantos tokens e quanto
    custou. Base do limite por dia, do orcamento mensal e do relatorio de consumo do admin. Nao guarda
    texto da conversa. Sem chave estrangeira para usuario: excluir a conta nao apaga o consumo, e o
    e-mail fica como na auditoria. Tabela nova: o create_all() cria sozinho."""

    __tablename__ = "ai_usage"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, index=True)
    user_id = Column(Integer, nullable=True, index=True)
    user_email = Column(String, nullable=True)
    provider = Column(String, nullable=False)
    model = Column(String, nullable=False)
    report_id = Column(Integer, nullable=True)
    llm_calls = Column(Integer, nullable=False, default=0)
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    # Dolares. Nulo quando nao da para calcular (provedor sem tabela de precos, modelo sem preco)
    cost_usd = Column(Float, nullable=True)

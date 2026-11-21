from sqlalchemy import Column, DateTime, String, Text, func

from app.core.database import Base


class EmailTemplate(Base):
    """Texto personalizado de um e-mail que o sistema envia (ver core/email_templates.py para a lista e os padroes).

    So existe linha para o e-mail que o administrador mexeu, e cada campo nulo vale o texto padrao. Apagar a linha
    devolve o e-mail ao padrao. E tabela nova, entao o create_all() cria sozinho."""

    __tablename__ = "email_templates"

    key = Column(String, primary_key=True)
    subject = Column(String, nullable=True)
    body = Column(Text, nullable=True)
    button = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

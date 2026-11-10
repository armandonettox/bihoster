from sqlalchemy import Boolean, Column, DateTime, Integer, Text

from app.core.database import Base


class AIReportSettings(Base):
    """O que o admin combinou com a IA para um relatorio: orientacoes em texto (o que cada coluna
    significa), colunas que a IA nunca consulta e se ela pode receber a imagem da pagina aberta.
    Sem chave estrangeira para o relatorio: quem apaga o relatorio apaga esta linha junto (sem isso, um
    id reaproveitado herdaria as configuracoes). Tabela nova: o create_all() cria sozinho."""

    __tablename__ = "ai_report_settings"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, nullable=False, unique=True, index=True)
    notes = Column(Text, nullable=True)
    # Lista em JSON de {"table": ..., "column": ...}
    blocked_columns_json = Column(Text, nullable=True)
    # Nulo ou falso = a IA nunca recebe imagem deste relatorio (decisao de privacidade: so o admin liga)
    allow_images = Column(Boolean, nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)

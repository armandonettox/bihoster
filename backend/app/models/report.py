from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, func

from app.core.database import Base


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    collection_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    # Qual conta/Service Principal do Power BI usar para esse relatorio (suporta mais de uma conta).
    powerbi_connection_id = Column(Integer, ForeignKey("powerbi_connections.id"), nullable=True)
    # Identificadores do Power BI -- prefixo pbi_ pra nao confundir com o "workspace"/colecao
    # do proprio app (collection_id acima), que e um conceito totalmente diferente.
    pbi_workspace_id = Column(String, nullable=False)
    pbi_report_id = Column(String, nullable=False)
    pbi_dataset_id = Column(String, nullable=True)
    # Secao da colecao onde o relatorio aparece: relatorio, painel, apresentacao ou tv
    display_type = Column(String, default="relatorio", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

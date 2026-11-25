from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func

from app.core.database import Base


class CatalogSync(Base):
    """Uma rodada de sincronizacao do catalogo de uma conta do Power BI: quem pediu (nulo = a
    rotina agendada), quando comecou e terminou e quantos itens mudaram."""

    __tablename__ = "catalog_syncs"

    id = Column(Integer, primary_key=True, index=True)
    connection_id = Column(Integer, ForeignKey("powerbi_connections.id"), nullable=False, index=True)
    started_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)
    reports_new = Column(Integer, nullable=True)
    reports_updated = Column(Integer, nullable=True)
    reports_missing = Column(Integer, nullable=True)
    datasets_new = Column(Integer, nullable=True)
    datasets_updated = Column(Integer, nullable=True)
    datasets_missing = Column(Integer, nullable=True)
    error = Column(Text, nullable=True)


class PbiDataset(Base):
    """Modelo semantico (dataset) visto no tenant. Existe uma vez por (conta, workspace, dataset);
    e a base do modulo Modelos semanticos e, mais adiante, do mapeamento de RLS e OLS."""

    __tablename__ = "pbi_datasets"
    __table_args__ = (UniqueConstraint("connection_id", "pbi_workspace_id", "pbi_dataset_id", name="uq_pbi_dataset"),)

    id = Column(Integer, primary_key=True, index=True)
    connection_id = Column(Integer, ForeignKey("powerbi_connections.id"), nullable=False, index=True)
    pbi_workspace_id = Column(String, nullable=False)
    pbi_workspace_name = Column(String, nullable=True)
    pbi_dataset_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    # Se o modelo exige identidade (RLS); o Power BI informa na propria listagem
    is_effective_identity_required = Column(Boolean, nullable=True)
    synced_at = Column(DateTime(timezone=True), nullable=True)
    sync_missing_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

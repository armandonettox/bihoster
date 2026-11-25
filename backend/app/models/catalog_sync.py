from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func

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
    # Marca o modelo cujo RLS depende SO das funcoes (nenhuma regra usa USERNAME()): pessoas com o mesmo conjunto de funcoes
    # podem dividir o mesmo token de embed. Nulo = o token e por pessoa. Nulavel de proposito (ver regra 1 do AGENTS.md).
    rls_shared_by_roles = Column(Boolean, nullable=True)
    synced_at = Column(DateTime(timezone=True), nullable=True)
    sync_missing_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class DatasetRoleGrant(Base):
    """Uma funcao de seguranca (RLS e OLS) do Power BI dada a um grupo ou a uma pessoa num modelo semantico.

    Exatamente um entre group_id e user_id. O nome da funcao e digitado por quem configura: o portal nao cria nem altera
    funcoes no Power BI. O token de embed leva a uniao das funcoes dos grupos da pessoa e das dadas a ela (o Power BI
    tambem soma funcoes). Sem nenhuma linha para o modelo, tudo funciona como antes. E tabela nova."""

    __tablename__ = "dataset_role_grants"
    __table_args__ = (
        CheckConstraint(
            "(group_id IS NOT NULL AND user_id IS NULL) OR (group_id IS NULL AND user_id IS NOT NULL)",
            name="ck_dataset_role_one_subject",
        ),
        UniqueConstraint("dataset_id", "group_id", "pbi_role", name="uq_dataset_role_group"),
        UniqueConstraint("dataset_id", "user_id", "pbi_role", name="uq_dataset_role_user"),
    )

    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("pbi_datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    pbi_role = Column(String, nullable=False)

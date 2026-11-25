from sqlalchemy import CheckConstraint, Column, ForeignKey, Index, Integer, String, UniqueConstraint

from app.core.database import Base


class ConnectionGrant(Base):
    """Uma permissao dada a um grupo ou a uma pessoa numa conta do Power BI so (hoje: sincronizar o catalogo; depois, a
    capacidade). Tabela propria, como report_grants e dataset_grants: o motor e o editor de permissoes de hoje nao enxergam
    estas linhas. Exatamente um entre group_id e user_id. So soma: a permissao numa conta se junta a geral (quem tem
    `conexao.sincronizar` geral sincroniza todas). O grupo Administradores nao precisa de linhas. E tabela nova."""

    __tablename__ = "connection_grants"
    __table_args__ = (
        CheckConstraint(
            "(group_id IS NOT NULL AND user_id IS NULL) OR (group_id IS NULL AND user_id IS NOT NULL)",
            name="ck_connection_grant_one_subject",
        ),
        UniqueConstraint("connection_id", "group_id", "permission_key", name="uq_connection_grant_group"),
        UniqueConstraint("connection_id", "user_id", "permission_key", name="uq_connection_grant_user"),
        Index("ix_connection_grants_group", "group_id"),
        Index("ix_connection_grants_user", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    connection_id = Column(Integer, ForeignKey("powerbi_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    permission_key = Column(String, nullable=False)  # ex: "conexao.sincronizar"

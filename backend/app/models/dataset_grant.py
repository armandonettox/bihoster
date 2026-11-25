from sqlalchemy import CheckConstraint, Column, ForeignKey, Index, Integer, String, UniqueConstraint

from app.core.database import Base


class DatasetGrant(Base):
    """Uma permissao dada a um grupo ou a uma pessoa num modelo semantico so (ver, atualizar, historico, seguranca,
    compartilhar). Tabela propria, como report_grants: o motor e o editor de permissoes de hoje nao enxergam estas linhas.
    Exatamente um entre group_id e user_id. So soma: o acesso a um modelo e a uniao do que foi dado nele com o que as
    permissoes gerais dao (ver core/access_engine.py). `modelo.ver` NAO da acesso aos relatorios do modelo. O grupo
    Administradores nao precisa de linhas. E tabela nova, entao o create_all() cria sozinho."""

    __tablename__ = "dataset_grants"
    __table_args__ = (
        CheckConstraint(
            "(group_id IS NOT NULL AND user_id IS NULL) OR (group_id IS NULL AND user_id IS NOT NULL)",
            name="ck_dataset_grant_one_subject",
        ),
        UniqueConstraint("dataset_id", "group_id", "permission_key", name="uq_dataset_grant_group"),
        UniqueConstraint("dataset_id", "user_id", "permission_key", name="uq_dataset_grant_user"),
        Index("ix_dataset_grants_group", "group_id"),
        Index("ix_dataset_grants_user", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("pbi_datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    permission_key = Column(String, nullable=False)  # ex: "modelo.ver", "modelo.atualizar"


class DatasetInviteGrant(Base):
    """Permissao num modelo reservada para um e-mail convidado que ainda nao tem conta. Vale so se o convite ainda existir
    quando a pessoa se cadastrar (ver core/access_pending.py). E tabela nova."""

    __tablename__ = "dataset_invite_grants"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False, index=True)
    dataset_id = Column(Integer, ForeignKey("pbi_datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    permission_key = Column(String, nullable=False)

from sqlalchemy import CheckConstraint, Column, ForeignKey, Index, Integer, String, UniqueConstraint

from app.core.database import Base


class ReportGrant(Base):
    """Uma permissao dada a um grupo ou a uma pessoa num relatorio so (ver, exportar, assinar...).

    Fica numa tabela propria, e nao em access_grants, de proposito: o motor e as telas de hoje (e a versao anterior do
    sistema, se alguem voltar) nao enxergam estas linhas, entao nada do que ja existe muda. Exatamente um entre
    group_id e user_id vem preenchido. Tambem so soma: o acesso a um relatorio e a uniao do que foi dado nele com o que
    foi dado a colecao em que ele esta (ver core/access_engine.py). O grupo Administradores nao precisa de linhas.
    E tabela nova, entao o create_all() cria sozinho."""

    __tablename__ = "report_grants"
    __table_args__ = (
        CheckConstraint(
            "(group_id IS NOT NULL AND user_id IS NULL) OR (group_id IS NULL AND user_id IS NOT NULL)",
            name="ck_report_grant_one_subject",
        ),
        UniqueConstraint("report_id", "group_id", "permission_key", name="uq_report_grant_group"),
        UniqueConstraint("report_id", "user_id", "permission_key", name="uq_report_grant_user"),
        Index("ix_report_grants_group", "group_id"),
        Index("ix_report_grants_user", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    permission_key = Column(String, nullable=False)  # ex: "relatorio.ver", "relatorio.exportar"


class ReportInviteGrant(Base):
    """Permissao num relatorio reservada para um e-mail convidado que ainda nao tem conta. Vale so se o convite ainda
    existir quando a pessoa se cadastrar (ver core/access_pending.py). E tabela nova."""

    __tablename__ = "report_invite_grants"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False, index=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False, index=True)
    permission_key = Column(String, nullable=False)


class ReportCollection(Base):
    """Uma pasta (colecao) em que um relatorio TAMBEM aparece, alem da colecao dele (reports.collection_id).

    Regra: o relatorio aparece numa pasta se a colecao dele e essa pasta ou se existe um vinculo aqui. Nunca guarda a
    propria colecao do relatorio (ela ja e reports.collection_id), para nao haver duas fontes da mesma informacao.
    `position` ordena o relatorio dentro desta pasta. E tabela nova, entao o create_all() cria sozinho."""

    __tablename__ = "report_collections"
    __table_args__ = (UniqueConstraint("report_id", "collection_id", name="uq_report_collection"),)

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False, index=True)
    collection_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    position = Column(Integer, nullable=True)

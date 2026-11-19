from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, func

from app.core.database import Base


class AccessGrant(Base):
    """Uma permissao dada a um grupo ou a uma pessoa, valendo no sistema todo ou so numa colecao.

    Exatamente um entre group_id e user_id vem preenchido. workspace_id vazio significa global.
    O grupo Administradores nao precisa de linhas: tem tudo sempre, calculado no codigo. A permissao
    da pessoa e a soma do que vem dos grupos dela com o que foi dado a ela (so soma, nunca nega).
    E tabela nova, entao o create_all() cria sozinho."""

    __tablename__ = "access_grants"
    __table_args__ = (
        CheckConstraint(
            "(group_id IS NOT NULL AND user_id IS NULL) OR (group_id IS NULL AND user_id IS NOT NULL)",
            name="ck_access_grant_one_subject",
        ),
        Index("ix_access_grants_group_scope", "group_id", "workspace_id"),
        Index("ix_access_grants_user_scope", "user_id", "workspace_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True)
    permission_key = Column(String, nullable=False)  # ex: "relatorio.publicar"


class AccessInviteGrant(Base):
    """Permissao reservada para um email convidado que ainda nao tem conta. So vale se o convite ainda existir
    quando a pessoa se cadastrar (ver core/access_pending.py); convite cancelado leva as permissoes junto.
    E tabela nova, entao o create_all() cria sozinho."""

    __tablename__ = "access_invite_grants"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True)
    permission_key = Column(String, nullable=False)


class AccessMigrationMark(Base):
    """Marca que a copia dos dados antigos (papel por colecao e permissoes de grupo) ja foi feita.
    Sem isso, reiniciar o servidor devolveria permissoes que o admin tirou na tela nova."""

    __tablename__ = "access_migration_mark"

    id = Column(Integer, primary_key=True)
    done_at = Column(DateTime(timezone=True), server_default=func.now())

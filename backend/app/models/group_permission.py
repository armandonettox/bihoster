from sqlalchemy import Column, ForeignKey, Integer, String, UniqueConstraint

from app.core.database import Base


class GroupPermission(Base):
    """Permissao de funcionalidade dada a um grupo global (hoje so as de IA, ver core/ai_access.py).

    Uma linha por par grupo e chave. O grupo Administradores nao precisa de linhas: tem tudo
    sempre, calculado no codigo. E tabela nova, entao o create_all() cria sozinho."""

    __tablename__ = "group_permissions"
    __table_args__ = (UniqueConstraint("group_id", "permission_key", name="uq_group_permission"),)

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False, index=True)
    permission_key = Column(String, nullable=False)  # ex: "ia.usar"

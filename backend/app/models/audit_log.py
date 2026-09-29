from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    # Copia do email de quem agiu: quando o usuario e apagado o user_id vira nulo e, sem isso,
    # a autoria da acao se perderia. Coluna nulavel de proposito (migracao automatica do boot).
    user_email = Column(String, nullable=True)
    action = Column(String, nullable=False, index=True)
    entity = Column(String, nullable=False)
    entity_id = Column(String, nullable=True)
    details = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    user = relationship("User")

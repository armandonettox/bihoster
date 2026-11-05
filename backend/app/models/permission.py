from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, func

from app.core.database import Base


class PermissionLevel(Base):
    __tablename__ = "permission_levels"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)
    # Niveis do sistema nao podem ser excluidos, apenas editados
    is_system = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PermissionGrant(Base):
    __tablename__ = "permission_grants"

    id = Column(Integer, primary_key=True, index=True)
    level_id = Column(Integer, ForeignKey("permission_levels.id", ondelete="CASCADE"), nullable=False, index=True)
    # Chave da permissao, ex: "colecao.criar", "admin.marca"
    permission_key = Column(String, nullable=False)

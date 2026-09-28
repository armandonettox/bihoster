from sqlalchemy import Boolean, Column, Integer, String, ForeignKey, DateTime, Enum, func, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.models.user import UserRole


class Workspace(Base):
    __tablename__ = "workspaces"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True, nullable=False)
    description = Column(String, nullable=True)
    icon = Column(String, nullable=True)  # nome do icone Material Symbols, ou None (usa iniciais)
    color = Column(String, nullable=True)  # cor hex de fundo do icone/iniciais
    # Tempo de revezamento (segundos) entre os relatorios "Modo TV" desta colecao
    tv_interval_seconds = Column(Integer, default=15, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    reports = relationship("Report", cascade="all, delete-orphan", passive_deletes=False)
    access_entries = relationship("GroupWorkspaceAccess", cascade="all, delete-orphan", passive_deletes=False)


class Group(Base):
    """Grupo global (estilo Metabase) -- nao pertence a um workspace especifico. O nivel de
    acesso de um grupo em cada workspace/colecao fica em GroupWorkspaceAccess."""

    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)  # "Todos os usuarios" -- todo cadastro entra
    is_admin_group = Column(Boolean, default=False, nullable=False)  # "Administradores" -- admin da plataforma inteira
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (UniqueConstraint("group_id", "user_id", name="uq_group_member"),)

    id = Column(Integer, primary_key=True, index=True)
    # Indexados -- get_effective_role/get_effective_roles_map (core/workspace_deps.py) filtram
    # por user_id em toda requisicao autenticada; sem indice isso e um full table scan.
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    user = relationship("User")


class GroupWorkspaceAccess(Base):
    """Nivel de acesso de um grupo global numa colecao (workspace) especifica."""

    __tablename__ = "group_workspace_access"
    __table_args__ = (UniqueConstraint("group_id", "workspace_id", name="uq_group_workspace_access"),)

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False, index=True)
    role = Column(Enum(UserRole), nullable=False)

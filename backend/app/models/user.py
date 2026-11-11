import enum

from sqlalchemy import Column, ForeignKey, Integer, String, Enum, DateTime, func

from app.core.database import Base


class UserRole(str, enum.Enum):
    admin = "admin"
    editor = "editor"
    viewer = "viewer"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    # "password" ou "google" -- usuario cadastrado via Google tem uma senha aleatoria
    # inutilizavel (ver login_with_google), entao precisamos saber disso pra evitar
    # bloquear o unico admin da plataforma ao desativar o login com Google.
    registered_via = Column(String, default="password", nullable=False)
    # Preenchido na primeira vez que a pessoa entra pelo Google, mesmo que a conta tenha sido
    # criada com senha: a partir dai a conta e tratada como Google (sem troca de senha).
    # Nao mexe em registered_via, que continua dizendo se a senha e utilizavel.
    google_linked_at = Column(DateTime(timezone=True), nullable=True)
    # Foto do Google guardada no servidor (/static/uploads/avatar-...), atualizada a cada login
    picture_url = Column(String, nullable=True)
    # Dados do cadastro Google, atualizados a cada login: idioma (ex: pt-BR) e dominio do
    # Google Workspace (claim hd, so existe para conta de organizacao)
    google_locale = Column(String, nullable=True)
    google_hd = Column(String, nullable=True)
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Nivel de permissao funcional (nao e papel de colecao; e o nivel global de funcionalidades)
    permission_level_id = Column(Integer, ForeignKey("permission_levels.id", ondelete="SET NULL"), nullable=True)

import enum

from sqlalchemy import Column, Integer, String, Enum, DateTime, func

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
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

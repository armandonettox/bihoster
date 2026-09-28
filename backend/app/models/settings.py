from sqlalchemy import Boolean, Column, Integer, String

from app.core.crypto import EncryptedString
from app.core.database import Base


class AppSettings(Base):
    """Configuracoes globais de marca do sistema -- uma unica linha (id=1), compartilhada por todos os workspaces."""

    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, default=1)
    company_name = Column(String, default="BIHoster", nullable=False)
    primary_color = Column(String, default="#1E3A6B", nullable=False)
    secondary_color = Column(String, default="#5B9BD5", nullable=False)
    logo_url = Column(String, nullable=True)
    favicon_url = Column(String, nullable=True)
    login_image_url = Column(String, nullable=True)
    login_layout = Column(String, default="centered", nullable=False)  # "centered" ou "split"
    timezone = Column(String, default="America/Sao_Paulo", nullable=False)  # IANA, ex: "America/Sao_Paulo"
    site_url = Column(String, nullable=True)
    support_email = Column(String, nullable=True)
    force_https = Column(Boolean, default=False, nullable=False)
    default_workspace_id = Column(Integer, nullable=True)

    allow_registration = Column(Boolean, default=True, nullable=False)
    google_oauth_enabled = Column(Boolean, default=False, nullable=False)
    google_client_id = Column(String, nullable=True)
    google_client_secret = Column(EncryptedString, nullable=True)  # cifrado em repouso, nunca exposto pela API publica
    google_allowed_domains = Column(String, nullable=True)  # dominios separados por virgula, ex: "empresa.com,empresa.com.br"

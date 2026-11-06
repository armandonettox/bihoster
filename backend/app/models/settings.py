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

    # nullable por causa da migracao automatica: ALTER TABLE nao suporta DEFAULT, entao linhas
    # existentes chegam com NULL; _to_out usa bool() para normalizar antes de devolver ao cliente
    single_collection_redirect = Column(Boolean, default=False, nullable=True)

    allow_registration = Column(Boolean, default=True, nullable=False)
    google_oauth_enabled = Column(Boolean, default=False, nullable=False)
    google_client_id = Column(String, nullable=True)
    google_client_secret = Column(EncryptedString, nullable=True)  # cifrado em repouso, nunca exposto pela API publica
    google_allowed_domains = Column(String, nullable=True)  # dominios separados por virgula, ex: "empresa.com,empresa.com.br"

    # Servidor de e-mail (SMTP) usado pelas assinaturas de relatorio. Tudo nullable: a migracao
    # automatica so acrescenta colunas nulaveis, e e-mail nao configurado e um estado valido.
    # Nada disto entra em SettingsOut (a rota de configuracoes e publica): so as rotas de
    # /settings/email, restritas a administradores, leem e gravam.
    smtp_host = Column(String, nullable=True)
    smtp_port = Column(Integer, nullable=True)
    smtp_security = Column(String, nullable=True)  # "starttls", "ssl" ou "none"
    smtp_username = Column(String, nullable=True)
    smtp_password = Column(EncryptedString, nullable=True)  # cifrado em repouso, nunca devolvido pela API
    smtp_from_email = Column(String, nullable=True)
    smtp_from_name = Column(String, nullable=True)
    # Dominios que podem receber e-mail do sistema, separados por virgula. Vazio = qualquer um.
    email_allowed_domains = Column(String, nullable=True)

    # Cache de embed tokens do Power BI (ver core/cache_warmup.py).
    # Nullable para compatibilidade com instancias existentes; o router usa os defaults abaixo.
    cache_warmup_enabled = Column(Boolean, nullable=True)         # default True
    cache_warmup_interval_seconds = Column(Integer, nullable=True)  # default 240

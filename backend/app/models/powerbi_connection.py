from sqlalchemy import Column, DateTime, Integer, String, func

from app.core.crypto import EncryptedString
from app.core.database import Base


class PowerBIConnection(Base):
    """Uma conta/Service Principal do Azure AD usada para autenticar no Power BI. Um relatorio
    escolhe qual conta usar ao ser criado/editado -- permite ter mais de uma organizacao/tenant."""

    __tablename__ = "powerbi_connections"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    tenant_id = Column(String, nullable=False)
    client_id = Column(String, nullable=False)
    client_secret = Column(EncryptedString, nullable=False)  # cifrado em repouso, nunca exposto pela API
    created_at = Column(DateTime(timezone=True), server_default=func.now())

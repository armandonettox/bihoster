from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, func

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
    # Sincronizacao do catalogo (colunas nulaveis de proposito, ver regra 1 do AGENTS.md):
    # ids dos workspaces a importar em JSON (nulo ou "[]" = todos) e de quantas em quantas horas
    # sincronizar sozinho (nulo = so pelo botao).
    sync_workspaces_json = Column(Text, nullable=True)
    sync_interval_hours = Column(Integer, nullable=True)
    # Capacidade do Power BI (Azure), v1.54.0: tudo nulo por padrao. Sem os tres campos do Azure preenchidos nada roda.
    # `capacity_real_calls` so liga a chamada de verdade ao Azure quando e True (nulo/False = modo simulado, que so registra).
    # `capacity_schedule_json` guarda as faixas em que a capacidade deve ficar LIGADA (mesmo formato do horario de acesso);
    # fora delas a rotina pausa. `capacity_state` e a ultima acao registrada ("running" ou "paused").
    azure_subscription_id = Column(String, nullable=True)
    azure_resource_group = Column(String, nullable=True)
    azure_capacity_name = Column(String, nullable=True)
    capacity_real_calls = Column(Boolean, nullable=True)
    capacity_schedule_enabled = Column(Boolean, nullable=True)
    capacity_schedule_json = Column(Text, nullable=True)
    capacity_state = Column(String, nullable=True)
    capacity_state_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

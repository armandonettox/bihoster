from sqlalchemy import Column, DateTime, Integer, String, Text, func

from app.core.database import Base


class AuditDashboard(Base):
    """Layout do painel de Analiticos da auditoria, compartilhado por todos (uma linha so, id 1).

    `layout` e um JSON com a lista de visuais e a posicao e o tamanho de cada um (ver
    core/audit_dashboard.py). Sem linha, vale o painel padrao. E tabela nova, entao o
    create_all() cria sozinho."""

    __tablename__ = "audit_dashboards"

    id = Column(Integer, primary_key=True)
    layout = Column(Text, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by_id = Column(Integer, nullable=True)
    updated_by_email = Column(String, nullable=True)

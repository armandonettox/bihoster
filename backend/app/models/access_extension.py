from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, func

from app.core.database import Base

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_DENIED = "denied"
STATUS_REVOKED = "revoked"


class AccessExtensionRequest(Base):
    """Pedido de mais tempo de acesso, feito por quem esta fora do horario de acesso (ver core/access_schedule.py).

    Quem tem a permissao de liberar aprova (e escolhe ate quando vale) ou recusa. Aprovado, vale como uma liberacao
    temporaria: ate grant_until a pessoa usa o sistema mesmo fora do horario, e depois volta ao normal sozinha, sem
    ninguem precisar desfazer. status: pending, approved, denied ou revoked (liberacao encerrada antes da hora).
    E tabela nova, entao o create_all() cria sozinho."""

    __tablename__ = "access_extension_requests"
    __table_args__ = (Index("ix_access_extension_user_status", "user_id", "status"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String, nullable=False, default=STATUS_PENDING)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    decided_at = Column(DateTime(timezone=True), nullable=True)
    # Guarda o nome de quem decidiu: se a pessoa for removida depois, o registro continua dizendo quem foi
    decided_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_by_name = Column(String, nullable=True)
    note = Column(Text, nullable=True)  # motivo da recusa, se quem recusou escreveu um
    grant_until = Column(DateTime(timezone=True), nullable=True)

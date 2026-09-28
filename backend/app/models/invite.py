from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func

from app.core.database import Base


class GroupInvite(Base):
    """Convite pendente -- reserva um grupo para um email que ainda nao tem conta.
    Quando a pessoa se cadastra com esse email, ela entra automaticamente no grupo."""

    __tablename__ = "group_invites"
    __table_args__ = (UniqueConstraint("email", "group_id", name="uq_group_invite_email_group"),)

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    invited_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

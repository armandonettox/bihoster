from sqlalchemy import Column, Integer, ForeignKey, DateTime, func, UniqueConstraint

from app.core.database import Base


class Favorite(Base):
    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("user_id", "report_id", name="uq_favorite_user_report"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    report_id = Column(Integer, ForeignKey("reports.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

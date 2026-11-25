from sqlalchemy import Column, ForeignKey, Index, Integer, String, UniqueConstraint

from app.core.database import Base


class ReportOpenStat(Base):
    """Quantas vezes cada relatorio foi aberto em cada hora (UTC): a base do aquecimento so dos relatorios usados e da
    tabela de aberturas por hora na aba Cache e capacidade. `hour` e o texto "AAAA-MM-DDTHH" (ordena como data). So guarda
    contagem: nunca quem abriu. Tabela nova, entao o create_all() cria sozinho."""

    __tablename__ = "report_open_stats"
    __table_args__ = (UniqueConstraint("report_id", "hour", name="uq_report_open_hour"), Index("ix_report_open_hour", "hour"))

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False)
    hour = Column(String, nullable=False)
    opens = Column(Integer, nullable=False, default=0)

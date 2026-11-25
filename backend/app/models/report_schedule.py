from sqlalchemy import Column, ForeignKey, Index, Integer, String

from app.core.database import Base


class ReportScheduleRange(Base):
    """Uma faixa de horario em que UM relatorio pode ser aberto ou exportado (por quem nao e administrador da plataforma).

    Estende o horario de acesso de grupos e pessoas (`access_schedule_ranges`): aquele limita o uso do sistema todo, este
    limita um relatorio so. Relatorio sem nenhuma faixa nao tem limite. Os dias e os minutos seguem o mesmo formato (dias de
    0 = segunda a 6 = domingo, separados por virgula; minutos desde a meia-noite; fim menor que o inicio vira a madrugada
    seguinte) e valem no fuso configurado no sistema. E tabela nova, entao o create_all() cria sozinho."""

    __tablename__ = "report_schedule_ranges"
    __table_args__ = (Index("ix_report_schedule_report", "report_id"),)

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False)
    days = Column(String, nullable=False)
    start_minute = Column(Integer, nullable=False)
    end_minute = Column(Integer, nullable=False)

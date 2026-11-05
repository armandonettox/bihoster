import json

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, func

from app.core.database import Base

ALERT_CONDITIONS = (">", "<", ">=", "<=", "=", "!=")


class ReportAlert(Base):
    """Alerta que monitora o valor de uma medida do Power BI e dispara um e-mail quando a
    condicao e satisfeita (ex: 'Total Inadimplentes > 500')."""

    __tablename__ = "report_alerts"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by_name = Column(String, nullable=True)

    name = Column(String, nullable=True)
    # Medida monitorada: table_name pode ser None para medidas sem tabela explicita
    measure_name = Column(String, nullable=False)
    table_name = Column(String, nullable=True)
    # Condicao: ">", "<", ">=", "<=", "=", "!="
    condition = Column(String, nullable=False)
    threshold = Column(Float, nullable=False)

    recipients_json = Column(Text, nullable=True)
    subject = Column(String, nullable=True)
    message = Column(Text, nullable=True)

    enabled = Column(Boolean, nullable=False, default=True)
    # Frequencia de checagem e cooldown entre disparos
    check_interval_minutes = Column(Integer, nullable=False, default=60)
    cooldown_hours = Column(Integer, nullable=False, default=24)

    # Estado da ultima verificacao
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    last_triggered_at = Column(DateTime(timezone=True), nullable=True)
    last_value = Column(Float, nullable=True)
    last_status = Column(String, nullable=True)   # "ok", "triggered", "error"
    last_message = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    @property
    def recipients(self) -> list[str]:
        return json.loads(self.recipients_json or "[]")

    @recipients.setter
    def recipients(self, value: list[str]) -> None:
        self.recipients_json = json.dumps(list(value))

    @property
    def dax_expression(self) -> str:
        """Expressao DAX para consultar o valor atual desta medida."""
        if self.table_name:
            return f"'{self.table_name}'[{self.measure_name}]"
        return f"[{self.measure_name}]"

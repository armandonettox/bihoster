import json

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text, func

from app.core.database import Base


class ReportSubscription(Base):
    """Envio recorrente de um relatorio por e-mail (PDF ou imagem), em dias e horarios escolhidos."""

    __tablename__ = "report_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False, index=True)
    # Quem criou. Se a pessoa for apagada o id fica nulo e o nome continua aqui, pra tela dizer quem foi
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by_name = Column(String, nullable=True)

    name = Column(String, nullable=True)
    recipients_json = Column(Text, nullable=False)
    fmt = Column(String, nullable=False, default="PDF")  # "PDF" ou "PNG"

    # Recorrencia: dias da semana (0 = segunda ... 6 = domingo) e horarios "HH:MM" no fuso abaixo
    days_json = Column(Text, nullable=False)
    times_json = Column(Text, nullable=False)
    timezone = Column(String, nullable=False, default="America/Sao_Paulo")
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)

    subject = Column(String, nullable=True)
    message = Column(Text, nullable=True)

    enabled = Column(Boolean, nullable=False, default=True)
    # Proximo envio (UTC). E gravado ANTES de enviar: assim um horario nunca dispara duas vezes.
    next_run_at = Column(DateTime(timezone=True), nullable=True, index=True)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_status = Column(String, nullable=True)  # "ok", "error" ou "skipped"
    last_message = Column(String, nullable=True)
    consecutive_failures = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    @property
    def recipients(self) -> list[str]:
        return json.loads(self.recipients_json or "[]")

    @recipients.setter
    def recipients(self, value: list[str]) -> None:
        self.recipients_json = json.dumps(list(value))

    @property
    def days(self) -> list[int]:
        return json.loads(self.days_json or "[]")

    @days.setter
    def days(self, value: list[int]) -> None:
        self.days_json = json.dumps(list(value))

    @property
    def times(self) -> list[str]:
        return json.loads(self.times_json or "[]")

    @times.setter
    def times(self, value: list[str]) -> None:
        self.times_json = json.dumps(list(value))


def delete_subscriptions_of_reports(db, report_ids) -> None:
    """Apaga as assinaturas (e o historico) dos relatorios dados. O banco ja faz isso sozinho com
    ON DELETE CASCADE quando as chaves estrangeiras estao ligadas; aqui fica explicito pra nao
    depender disso (e pra funcionar em qualquer banco)."""
    ids = list(report_ids)
    if not ids:
        return
    sub_ids = [s for (s,) in db.query(ReportSubscription.id).filter(ReportSubscription.report_id.in_(ids)).all()]
    if sub_ids:
        db.query(SubscriptionRun).filter(SubscriptionRun.subscription_id.in_(sub_ids)).delete(synchronize_session=False)
        db.query(ReportSubscription).filter(ReportSubscription.id.in_(sub_ids)).delete(synchronize_session=False)


class SubscriptionRun(Base):
    """Historico: cada tentativa de envio de uma assinatura, com o resultado."""

    __tablename__ = "subscription_runs"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, ForeignKey("report_subscriptions.id", ondelete="CASCADE"), nullable=False, index=True)
    started_at = Column(DateTime(timezone=True), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, nullable=False)  # "ok", "error" ou "skipped"
    trigger = Column(String, nullable=False, default="schedule")  # "schedule" ou "manual"
    attempts = Column(Integer, nullable=False, default=1)
    message = Column(String, nullable=True)
    recipients_count = Column(Integer, nullable=False, default=0)

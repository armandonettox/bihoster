from sqlalchemy import CheckConstraint, Column, ForeignKey, Index, Integer, String

from app.core.database import Base


class AccessScheduleRange(Base):
    """Uma faixa de horario em que um grupo ou uma pessoa pode usar o sistema.

    Exatamente um entre group_id e user_id vem preenchido. Quem tem faixas so entra dentro delas; quem nao tem nenhuma
    (nem na pessoa nem em grupo algum) nao tem limite. A pessoa que tem faixas proprias (a excecao individual) usa so
    elas, no lugar das dos grupos. Os administradores da plataforma nunca sao limitados.

    days guarda os dias da semana como numeros separados por virgula (0 = segunda ... 6 = domingo). Os horarios ficam em
    minutos desde a meia-noite (start de 0 a 1439, end de 1 a 1440); end menor que start vira a madrugada do dia
    seguinte. E tabela nova, entao o create_all() cria sozinho."""

    __tablename__ = "access_schedule_ranges"
    __table_args__ = (
        CheckConstraint(
            "(group_id IS NOT NULL AND user_id IS NULL) OR (group_id IS NULL AND user_id IS NOT NULL)",
            name="ck_access_schedule_one_subject",
        ),
        Index("ix_access_schedule_group", "group_id"),
        Index("ix_access_schedule_user", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    days = Column(String, nullable=False)  # ex: "0,1,2,3,4"
    start_minute = Column(Integer, nullable=False)
    end_minute = Column(Integer, nullable=False)

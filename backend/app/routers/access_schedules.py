"""Horario de acesso de grupos e pessoas (ver core/access_schedule.py): quem tem faixas so entra dentro delas."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.access_deps import require_any_global_permission, require_global_permission
from app.core.access_guard import check_can_touch_account
from app.core.access_schedule import (
    MAX_RANGES,
    describe,
    format_days,
    format_minute,
    parse_clock,
    parse_days,
)
from app.core.audit import log_action
from app.core.audit_filters import system_tz
from app.core.database import get_db
from app.core.workspace_deps import is_platform_admin
from app.models.access_schedule import AccessScheduleRange
from app.models.report import Report
from app.models.report_schedule import ReportScheduleRange
from app.models.user import User
from app.models.workspace import Group, GroupMember

router = APIRouter(prefix="/access-schedules", tags=["access-schedules"])


class RangeIO(BaseModel):
    days: list[int]
    start: str
    end: str


class ScheduleIn(BaseModel):
    ranges: list[RangeIO] = Field(default_factory=list, max_length=MAX_RANGES)


class ScheduleOut(BaseModel):
    ranges: list[RangeIO]
    timezone: str


def _out(db: Session, rows) -> ScheduleOut:
    return ScheduleOut(
        ranges=[
            RangeIO(days=sorted(parse_days(r.days)), start=format_minute(r.start_minute), end=format_minute(r.end_minute))
            for r in rows
        ],
        timezone=system_tz(db)[1],
    )


def _validated(data: ScheduleIn) -> list[tuple[str, int, int]]:
    """Confere cada faixa e devolve (dias, inicio, fim). Erro de formato vira 400 com mensagem para a tela."""
    result = []
    for item in data.ranges:
        if not item.days or any(not 0 <= d <= 6 for d in item.days):
            raise HTTPException(status_code=400, detail="Escolha pelo menos um dia da semana em cada faixa.")
        days = set(item.days)  # dia repetido vale uma vez so
        try:
            start = parse_clock(item.start, is_end=False)
            end = parse_clock(item.end, is_end=True)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        if start == end:
            raise HTTPException(status_code=400, detail="O início e o fim da faixa não podem ser iguais.")
        result.append((format_days(days), start, end))
    return result


def _replace(db: Session, rows: list[tuple[str, int, int]], **subject) -> None:
    db.query(AccessScheduleRange).filter_by(**subject).delete(synchronize_session=False)
    for days, start, end in rows:
        db.add(AccessScheduleRange(days=days, start_minute=start, end_minute=end, **subject))
    db.commit()


def _summary(rows: list[tuple[str, int, int]]) -> str:
    if not rows:
        return "sem faixas"
    fake = [AccessScheduleRange(days=d, start_minute=s, end_minute=e) for d, s, e in rows]
    return "; ".join(describe(fake))


@router.get("/groups/{group_id}", response_model=ScheduleOut)
def get_group_schedule(
    group_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_any_global_permission("grupos.ver", "membros.horario")),
):
    if not db.query(Group.id).filter(Group.id == group_id).first():
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")
    return _out(db, db.query(AccessScheduleRange).filter(AccessScheduleRange.group_id == group_id).order_by(AccessScheduleRange.id).all())


@router.put("/groups/{group_id}", response_model=ScheduleOut)
def set_group_schedule(
    group_id: int,
    data: ScheduleIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("membros.horario")),
):
    group = db.query(Group).get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")
    if group.is_admin_group:
        raise HTTPException(status_code=400, detail="Administradores da plataforma nunca são limitados por horário.")
    # Quem esta no grupo nao afrouxa o proprio limite: outra pessoa muda o horario do grupo dela
    if not is_platform_admin(db, current_user.id) and (
        db.query(GroupMember).filter(GroupMember.group_id == group_id, GroupMember.user_id == current_user.id).first()
    ):
        raise HTTPException(status_code=400, detail="Você faz parte deste grupo e não pode mudar o horário dele. Peça para outra pessoa.")

    rows = _validated(data)
    _replace(db, rows, group_id=group_id)
    log_action(db, action="set_group_schedule", entity="group", user_id=current_user.id, entity_id=group_id, details=f"{group.name}: {_summary(rows)}")
    return _out(db, db.query(AccessScheduleRange).filter(AccessScheduleRange.group_id == group_id).order_by(AccessScheduleRange.id).all())


@router.get("/users/{user_id}", response_model=ScheduleOut)
def get_user_schedule(
    user_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_any_global_permission("membros.ver", "membros.horario")),
):
    if not db.query(User.id).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    return _out(db, db.query(AccessScheduleRange).filter(AccessScheduleRange.user_id == user_id).order_by(AccessScheduleRange.id).all())


@router.put("/users/{user_id}", response_model=ScheduleOut)
def set_user_schedule(
    user_id: int,
    data: ScheduleIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("membros.horario")),
):
    """A excecao individual: com faixas aqui, a pessoa usa so elas, no lugar das dos grupos. Sem faixas, volta a seguir os grupos."""
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    if user_id == current_user.id and not is_platform_admin(db, current_user.id):
        raise HTTPException(status_code=400, detail="Você não pode mudar o seu próprio horário de acesso.")
    check_can_touch_account(db, current_user, user_id)

    rows = _validated(data)
    _replace(db, rows, user_id=user_id)
    log_action(db, action="set_user_schedule", entity="user", user_id=current_user.id, entity_id=user_id, details=f"{user.email}: {_summary(rows)}")
    return _out(db, db.query(AccessScheduleRange).filter(AccessScheduleRange.user_id == user_id).order_by(AccessScheduleRange.id).all())


def _report_rows(db: Session, report_id: int):
    return db.query(ReportScheduleRange).filter(ReportScheduleRange.report_id == report_id).order_by(ReportScheduleRange.id).all()


@router.get("/reports/{report_id}", response_model=ScheduleOut)
def get_report_schedule(
    report_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_global_permission("membros.horario")),
):
    """O horario em que UM relatorio pode ser aberto. Sem faixas, o relatorio nao tem limite."""
    if not db.query(Report.id).filter(Report.id == report_id).first():
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")
    return _out(db, _report_rows(db, report_id))


@router.put("/reports/{report_id}", response_model=ScheduleOut)
def set_report_schedule(
    report_id: int,
    data: ScheduleIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("membros.horario")),
):
    """Troca as faixas do relatorio (lista vazia = sem limite). So vale para quem nao e administrador da plataforma."""
    report = db.query(Report).get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")
    rows = _validated(data)
    db.query(ReportScheduleRange).filter(ReportScheduleRange.report_id == report_id).delete(synchronize_session=False)
    for days, start, end in rows:
        db.add(ReportScheduleRange(report_id=report_id, days=days, start_minute=start, end_minute=end))
    db.commit()
    log_action(
        db, action="set_report_schedule", entity="report", user_id=current_user.id, entity_id=report_id,
        details=f"{report.name}: {_summary(rows)}",
    )
    return _out(db, _report_rows(db, report_id))


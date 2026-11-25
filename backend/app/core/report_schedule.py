"""Horario de acesso por relatorio (v1.53.0): um relatorio com faixas so abre, e so exporta, dentro delas.

Vale para quem nao e administrador da plataforma (o administrador nunca e limitado, como no horario de acesso geral). Uma
liberacao temporaria aprovada (`access_extension_requests`) tambem libera o relatorio ate o prazo. A conferencia roda no
mesmo ponto das permissoes do relatorio (`require_report_permission`), so para os itens de abrir e exportar: gerenciar,
editar ou excluir o relatorio nao depende do horario."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core import access_schedule
from app.core.access_schedule import Decision, describe, next_open, ranges_allow
from app.core.audit_filters import system_tz
from app.models.access_extension import STATUS_APPROVED, AccessExtensionRequest
from app.models.report_schedule import ReportScheduleRange
from app.models.user import User

REPORT_OUTSIDE_HOURS_CODE = "report_outside_hours"
# Os itens que abrem o conteudo do relatorio: o horario vale para eles
GATED_KEYS = frozenset({"relatorio.ver", "relatorio.exportar"})


def evaluate_report_schedule(db: Session, user: User, report_id: int, now=None) -> Decision:
    """Diz se a pessoa pode abrir o relatorio agora. Sem faixa nenhuma e uma consulta barata (indice por relatorio)."""
    rows = db.query(ReportScheduleRange).filter(ReportScheduleRange.report_id == report_id).all()
    if not rows:
        return Decision(allowed=True)
    # Import aqui dentro: workspace_deps carrega o auth, que carrega os modulos de horario (import circular)
    from app.core.workspace_deps import is_platform_admin

    if is_platform_admin(db, user.id):
        return Decision(allowed=True)
    tz, tz_name = system_tz(db)
    instant = now or access_schedule.now_utc()
    local_now = instant.astimezone(tz)
    if ranges_allow(rows, local_now):
        return Decision(allowed=True)
    release = (
        db.query(AccessExtensionRequest.id)
        .filter(
            AccessExtensionRequest.user_id == user.id,
            AccessExtensionRequest.status == STATUS_APPROVED,
            AccessExtensionRequest.grant_until > instant,
        )
        .first()
    )
    if release:
        return Decision(allowed=True)
    return Decision(allowed=False, next_open=next_open(rows, local_now), windows=describe(rows), timezone_name=tz_name)


def report_outside_hours_error(decision: Decision) -> HTTPException:
    """O erro de quem tenta abrir o relatorio fora do horario dele: 403 com o horario e a hora em que volta."""
    message = "Este relatório só pode ser aberto em certos horários"
    if decision.windows:
        message += ": " + "; ".join(decision.windows) + (f" ({decision.timezone_name})" if decision.timezone_name else "")
    return HTTPException(
        status_code=403,
        detail={
            "code": REPORT_OUTSIDE_HOURS_CODE,
            "message": message + ".",
            "next_open": decision.next_open.isoformat() if decision.next_open else None,
            "windows": decision.windows,
            "timezone": decision.timezone_name,
        },
    )


def ensure_report_open(db: Session, user: User, report_id: int) -> None:
    decision = evaluate_report_schedule(db, user, report_id)
    if not decision.allowed:
        raise report_outside_hours_error(decision)

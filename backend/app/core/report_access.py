"""Permissao por relatorio: gravar, conferir e explicar o que um grupo ou uma pessoa pode num relatorio so.

As concessoes ficam na tabela report_grants (ver models/report_grant.py). O calculo do acesso mora em
core/access_engine.py (`EffectiveAccess.report_keys`), que soma o que foi dado direto ao relatorio com o que a colecao
dele da. Aqui ficam as operacoes de gravacao e as defesas contra escalada, no mesmo espirito de core/access_guard.py:
so se da e se tira o que se tem."""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core import access_catalog
from app.core.access_catalog import REPORT_CAPABLE, REPORT_SHARE, REPORT_VIEW, report_requires, with_implied_report
from app.core.access_engine import EffectiveAccess, effective_access, folders_of_report
from app.models.report import Report
from app.models.report_grant import ReportGrant, ReportInviteGrant
from app.models.user import User
from app.models.workspace import Workspace

GROUP = "group_id"
USER = "user_id"


def validate_keys(keys: list[str]) -> list[str]:
    """So aceita itens que valem num relatorio, sem repetidos e ja com o que cada um exige (exportar exige ver)."""
    unknown = [key for key in keys if key not in REPORT_CAPABLE]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Permissao que nao vale num relatorio: {', '.join(sorted(set(unknown)))}")
    return with_implied_report(keys)


def with_dependents(keys: set[str]) -> set[str]:
    """Os itens a remover junto: tirar "ver o relatorio" tira tudo o que o exige (exportar, assinar...)."""
    result = set(keys)
    changed = True
    while changed:
        changed = False
        for key in REPORT_CAPABLE:
            if key not in result and any(required in result for required in report_requires(key)):
                result.add(key)
                changed = True
    return result


def can_manage(access: EffectiveAccess, report: Report, also_in: list[int] | tuple[int, ...] = ()) -> bool:
    """Quem pode mexer nos acessos de um relatorio: o administrador, quem tem a permissao geral de dar permissoes ou
    quem recebeu o item "compartilhar" nesse relatorio. Em todos os casos so se da o que se tem (check_can_change)."""
    return access.is_admin or access.has_global("permissoes.editar") or access.has_in_report(REPORT_SHARE, report.id, report.collection_id, also_in)


def require_can_manage(db: Session, actor: User, report: Report) -> EffectiveAccess:
    access = effective_access(db, actor.id)
    if not can_manage(access, report, folders_of_report(db, report.id)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Voce nao pode mudar os acessos deste relatorio")
    return access


def check_can_change(access: EffectiveAccess, report: Report, changed: set[str], also_in: list[int] | tuple[int, ...] = ()) -> None:
    """Tudo o que entra ou sai precisa ser algo que quem faz a mudanca tem neste relatorio."""
    if access.is_admin:
        return
    missing = sorted(key for key in changed if not access.has_in_report(key, report.id, report.collection_id, also_in))
    if missing:
        labels = ", ".join(dict.fromkeys(access_catalog.get(key).label if access_catalog.get(key) else key for key in missing))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Voce so pode dar ou tirar permissoes que voce mesmo tem neste relatorio. Faltam: {labels}",
        )


def subject_keys(db: Session, report_id: int, subject: str, subject_id: int) -> set[str]:
    rows = db.query(ReportGrant.permission_key).filter(ReportGrant.report_id == report_id, getattr(ReportGrant, subject) == subject_id).all()
    return {row[0] for row in rows}


def set_subject_keys(db: Session, report_id: int, subject: str, subject_id: int, keys: set[str]) -> tuple[set[str], set[str]]:
    """Deixa o grupo ou a pessoa com exatamente `keys` neste relatorio. Devolve (antes, depois). Quem chama faz o commit."""
    rows = db.query(ReportGrant).filter(ReportGrant.report_id == report_id, getattr(ReportGrant, subject) == subject_id).all()
    before = {row.permission_key for row in rows}
    for row in rows:
        if row.permission_key not in keys:
            db.delete(row)
    for key in keys - before:
        db.add(ReportGrant(report_id=report_id, permission_key=key, **{subject: subject_id}))
    return before, set(keys)


def collection_name_for_audit(db: Session, report: Report) -> int | None:
    """A Raiz nao e uma colecao para a auditoria: as acoes dos relatorios dela ficam sem colecao."""
    workspace = db.query(Workspace).get(report.collection_id)
    return None if workspace is None or workspace.system_key is not None else workspace.id


def apply_pending_report_grants(db: Session, user: User, had_invites: bool) -> bool:
    """Chamada quando a conta e criada: aplica o que foi reservado para o e-mail em relatorios (so se havia convite) e
    apaga o resto. Devolve se mexeu no banco; quem chama faz o commit."""
    rows = db.query(ReportInviteGrant).filter(ReportInviteGrant.email == user.email).all()
    if not rows:
        return False
    if had_invites:
        existing_reports = {row.id for row in db.query(Report.id).filter(Report.id.in_({r.report_id for r in rows})).all()}
        taken = {(g.report_id, g.permission_key) for g in db.query(ReportGrant).filter(ReportGrant.user_id == user.id).all()}
        for row in rows:
            if row.report_id in existing_reports and (row.report_id, row.permission_key) not in taken and row.permission_key in REPORT_CAPABLE:
                db.add(ReportGrant(report_id=row.report_id, user_id=user.id, permission_key=row.permission_key))
    for row in rows:
        db.delete(row)
    return True


__all__ = [
    "GROUP",
    "USER",
    "REPORT_VIEW",
    "validate_keys",
    "with_dependents",
    "can_manage",
    "require_can_manage",
    "check_can_change",
    "subject_keys",
    "set_subject_keys",
    "collection_name_for_audit",
    "apply_pending_report_grants",
]

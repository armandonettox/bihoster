"""Permissoes de quem foi convidado e ainda nao tem conta.

Ficam guardadas por email (tabela access_invite_grants) e so valem enquanto existir convite pendente para esse
email. Quando a pessoa se cadastra, elas viram permissoes avulsas dela; se o ultimo convite e cancelado, somem."""

from sqlalchemy.orm import Session

from app.models.access_grant import AccessGrant, AccessInviteGrant
from app.models.invite import GroupInvite
from app.models.report_grant import ReportInviteGrant
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.access import GrantBlock


def replace_pending(db: Session, email: str, blocks: list[GrantBlock]) -> None:
    """Troca tudo o que estava reservado para o email. Quem chama faz o commit."""
    db.query(AccessInviteGrant).filter(AccessInviteGrant.email == email).delete(synchronize_session=False)
    for block in blocks:
        for key in block.permissions:
            db.add(AccessInviteGrant(email=email, workspace_id=block.workspace_id, permission_key=key))


def drop_if_no_invite(db: Session, email: str) -> None:
    """Sem nenhum convite pendente para o email, as permissoes reservadas nao tem mais motivo de existir."""
    if db.query(GroupInvite.id).filter(GroupInvite.email == email).first() is None:
        db.query(AccessInviteGrant).filter(AccessInviteGrant.email == email).delete(synchronize_session=False)
        db.query(ReportInviteGrant).filter(ReportInviteGrant.email == email).delete(synchronize_session=False)


def consume_pending(db: Session, user: User, had_invites: bool) -> bool:
    """Chamada quando a conta e criada. Aplica as permissoes reservadas so se havia convite; o que sobrar
    para o email e apagado de qualquer jeito. Devolve se mexeu no banco (quem chama faz o commit)."""
    from app.core.report_access import apply_pending_report_grants  # import aqui: o modulo importa o motor de acesso

    report_changed = apply_pending_report_grants(db, user, had_invites)
    rows = db.query(AccessInviteGrant).filter(AccessInviteGrant.email == user.email).all()
    if not rows:
        return report_changed
    if had_invites:
        workspace_ids = {row.id for row in db.query(Workspace.id).all()}
        taken = {
            (grant.workspace_id, grant.permission_key)
            for grant in db.query(AccessGrant).filter(AccessGrant.user_id == user.id).all()
        }
        for row in rows:
            if row.workspace_id is not None and row.workspace_id not in workspace_ids:
                continue
            if (row.workspace_id, row.permission_key) in taken:
                continue
            db.add(AccessGrant(user_id=user.id, workspace_id=row.workspace_id, permission_key=row.permission_key))
    for row in rows:
        db.delete(row)
    return True

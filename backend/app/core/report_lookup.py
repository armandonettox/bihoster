"""Achar um relatorio pelo caminho de uma pasta.

Um relatorio tem uma colecao (reports.collection_id) e pode aparecer tambem em outras pastas (report_collections).
As rotas `/workspaces/{id}/.../reports/{rid}` aceitam o id de qualquer uma delas: o mesmo relatorio abre pelo caminho da
pasta em que a pessoa o encontrou."""

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.report import Report
from app.models.report_grant import ReportCollection


def report_in_workspace(workspace_id: int):
    """Condicao SQL: o relatorio esta na colecao `workspace_id` ou aparece nela por vinculo."""
    linked = Report.id.in_(
        select(ReportCollection.report_id).where(ReportCollection.collection_id == workspace_id)
    )
    return or_(Report.collection_id == workspace_id, linked)


def find_report(db: Session, workspace_id: int, report_id: int) -> Report | None:
    return db.query(Report).filter(Report.id == report_id, report_in_workspace(workspace_id)).first()

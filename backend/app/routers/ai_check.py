import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core import chat_dataset
from app.core.ai_access import require_ai_manage
from app.core.database import get_db
from app.core.workspace_deps import get_effective_role
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.user import User
from app.schemas.ai_check import AIReportCheckOut

router = APIRouter(prefix="/ai", tags=["ai-check"])


@router.get("/reports/{report_id}/check", response_model=AIReportCheckOut)
def check_report_for_chat(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ai_manage),
):
    """Diz se o chat consegue consultar o relatorio e quantas tabelas, colunas e medidas ele tem.
    Serve para validar um relatorio de verdade antes de o chat existir. Quem pede precisa gerenciar
    a IA e tambem ter acesso a colecao do relatorio."""
    report = db.query(Report).get(report_id)
    if report is None or get_effective_role(db, current_user.id, report.collection_id) is None:
        # Mesma resposta para "nao existe" e "sem acesso": nao revela que o relatorio existe
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")

    started = time.monotonic()
    connection = db.query(PowerBIConnection).get(report.powerbi_connection_id) if report.powerbi_connection_id else None
    if connection is None:
        return AIReportCheckOut(
            report_id=report.id,
            report_name=report.name,
            eligible=False,
            reason="Este relatorio nao tem uma conta do Power BI configurada.",
            tables=None,
            columns=None,
            measures=None,
            latency_ms=int((time.monotonic() - started) * 1000),
        )

    eligibility = chat_dataset.check_eligibility(connection, report)
    tables = columns = measures = None
    if eligibility.ok:
        try:
            schema = chat_dataset.get_dataset_schema(connection, report)
        except chat_dataset.ChatDataError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        tables, columns, measures = len(schema.tables), schema.column_count, schema.measure_count

    return AIReportCheckOut(
        report_id=report.id,
        report_name=report.name,
        eligible=eligibility.ok,
        reason=eligibility.reason,
        tables=tables,
        columns=columns,
        measures=measures,
        latency_ms=int((time.monotonic() - started) * 1000),
    )

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.audit_filters import system_tz, utc_range
from app.core.audit_query import GroupBy, Metric, QueryError, run_query
from app.core.database import get_db
from app.core.workspace_deps import require_platform_admin

router = APIRouter(tags=["audit"])


class QueryRowOut(BaseModel):
    key: str
    label: str
    value: int


class QueryOut(BaseModel):
    metric: Metric
    metric_label: str
    group_by: GroupBy
    rows: list[QueryRowOut]
    # A medida no periodo todo, sem o corte do "top N"
    total: int
    timezone: str


@router.get("/audit/query", response_model=QueryOut)
def audit_query(
    metric: Metric,
    group_by: GroupBy = "none",
    limit: int = Query(8, ge=1, le=50),
    action: Optional[list[str]] = Query(None),
    user_id: Optional[list[int]] = Query(None),
    workspace_id: Optional[list[int]] = Query(None),
    report_id: Optional[list[int]] = Query(None),
    entity: Optional[list[str]] = Query(None),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    _=Depends(require_platform_admin),
):
    """Numero ou serie de um visual personalizado: uma medida repartida por um agrupamento, com os
    mesmos filtros da tabela e dos analiticos."""
    tz, tz_name = system_tz(db)
    start, end = utc_range(tz, date_from, date_to)
    filters = dict(
        q=None,
        action=action,
        user_id=user_id,
        workspace_id=workspace_id,
        report_id=report_id,
        entity=entity,
        start=start,
        end=end,
    )
    try:
        result = run_query(
            db, metric=metric, group_by=group_by, limit=limit, filters=filters, tz=tz, date_from=date_from, date_to=date_to
        )
    except QueryError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return QueryOut(
        metric=result.metric,
        metric_label=result.metric_label,
        group_by=result.group_by,
        rows=[QueryRowOut(key=r.key, label=r.label, value=r.value) for r in result.rows],
        total=result.total,
        timezone=tz_name,
    )

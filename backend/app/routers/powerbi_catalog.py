from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core import powerbi
from app.core.database import get_db
from app.core.db_helpers import get_or_404
from app.core.workspace_deps import require_any_editor
from app.models.powerbi_connection import PowerBIConnection

router = APIRouter(prefix="/powerbi", tags=["powerbi"])

# Catalogo do Power BI muda raramente (novo workspace/relatorio publicado) -- cachear alguns
# minutos evita bater na API do Power BI toda vez que alguem abre o formulario de novo/editar
# relatorio (NewReportForm dispara essa cadeia de chamadas a cada montagem do componente).
_CATALOG_CACHE_TTL = timedelta(minutes=5)
_workspaces_cache: dict[int, tuple[datetime, list]] = {}
_reports_cache: dict[tuple[int, str], tuple[datetime, list]] = {}


def _get_connection_or_404(db: Session, connection_id: int) -> PowerBIConnection:
    return get_or_404(db, PowerBIConnection, "Conta do Power BI nao encontrada", id=connection_id)


@router.get("/connections/{connection_id}/workspaces")
def list_powerbi_workspaces(connection_id: int, db: Session = Depends(get_db), _=Depends(require_any_editor)):
    """Workspaces do Power BI que a service principal daquela conta enxerga -- usado para montar
    o seletor na hora de vincular um relatorio, em vez de digitar os IDs na mao.
    Restrito a quem e editor/admin em pelo menos uma colecao -- uma conta representa uma
    organizacao/tenant separada, entao nao pode ficar aberta a qualquer usuario logado."""
    powerbi.prune_expired(_workspaces_cache)
    cached = _workspaces_cache.get(connection_id)
    if cached:
        return cached[1]

    connection = _get_connection_or_404(db, connection_id)
    workspaces = powerbi.list_workspaces(connection)
    result = [{"id": w["id"], "name": w["name"]} for w in workspaces]
    _workspaces_cache[connection_id] = (datetime.now(timezone.utc) + _CATALOG_CACHE_TTL, result)
    return result


@router.get("/connections/{connection_id}/workspaces/{pbi_workspace_id}/reports")
def list_powerbi_reports(
    connection_id: int, pbi_workspace_id: str, db: Session = Depends(get_db), _=Depends(require_any_editor)
):
    """Relatorios publicados num workspace do Power BI, com o dataset ja preenchido."""
    powerbi.prune_expired(_reports_cache)
    cache_key = (connection_id, pbi_workspace_id)
    cached = _reports_cache.get(cache_key)
    if cached:
        return cached[1]

    connection = _get_connection_or_404(db, connection_id)
    reports = powerbi.list_reports(connection, pbi_workspace_id)
    result = [
        {"id": r["id"], "name": r["name"], "dataset_id": r.get("datasetId")}
        for r in reports
    ]
    _reports_cache[cache_key] = (datetime.now(timezone.utc) + _CATALOG_CACHE_TTL, result)
    return result

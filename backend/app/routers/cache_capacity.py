"""Aba "Cache e capacidade" (v1.54.0): aberturas de relatorio por hora e controle da capacidade do Power BI (Azure).
Tudo exige o item `sistema.cache`. O controle da capacidade tem tres travas (ver core/azure_capacity.py) e nunca chama o
Azure de verdade enquanto a conta estiver no modo simulado, que e o padrao."""

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core import azure_capacity, report_stats
from app.core.access_deps import require_global_permission
from app.core.access_schedule import format_minute, parse_clock
from app.core.audit import log_action
from app.core.database import get_db
from app.models.powerbi_connection import PowerBIConnection
from app.models.user import User

router = APIRouter(prefix="/cache-capacity", tags=["cache-capacity"])


class RangeIO(BaseModel):
    days: list[int]
    start: str
    end: str


class CapacityConfigIn(BaseModel):
    azure_subscription_id: Optional[str] = Field(default=None, max_length=100)
    azure_resource_group: Optional[str] = Field(default=None, max_length=200)
    azure_capacity_name: Optional[str] = Field(default=None, max_length=200)
    capacity_real_calls: Optional[bool] = None
    capacity_schedule_enabled: Optional[bool] = None
    schedule: list[RangeIO] = Field(default_factory=list, max_length=20)


def _config_out(db: Session, connection: PowerBIConnection) -> dict:
    return {
        "connection_id": connection.id,
        "name": connection.name,
        "azure_subscription_id": connection.azure_subscription_id,
        "azure_resource_group": connection.azure_resource_group,
        "azure_capacity_name": connection.azure_capacity_name,
        "configured": azure_capacity.is_configured(connection),
        "simulated": azure_capacity.is_simulated(connection),
        "capacity_schedule_enabled": bool(connection.capacity_schedule_enabled),
        "schedule": [
            {"days": sorted(int(d) for d in item.days.split(",") if d), "start": format_minute(item.start_minute), "end": format_minute(item.end_minute)}
            for item in azure_capacity.parse_schedule(connection.capacity_schedule_json)
        ],
        "state": connection.capacity_state,
        "state_at": connection.capacity_state_at,
    }


def _get_connection(db: Session, connection_id: int) -> PowerBIConnection:
    connection = db.get(PowerBIConnection, connection_id)
    if connection is None:
        raise HTTPException(status_code=404, detail="Conta nao encontrada")
    return connection


@router.get("/openings")
def get_openings(
    hours: int = Query(default=24, ge=1, le=720),
    db: Session = Depends(get_db),
    _: User = Depends(require_global_permission("sistema.cache")),
):
    """Aberturas por relatorio e por hora (so contagem, nunca quem abriu) nas ultimas `hours` horas."""
    return report_stats.openings(db, hours=hours)


@router.get("/connections")
def list_capacity(db: Session = Depends(get_db), _: User = Depends(require_global_permission("sistema.cache"))):
    return {
        "master_switch": azure_capacity.master_switch_on(db),
        "connections": [_config_out(db, c) for c in db.query(PowerBIConnection).order_by(PowerBIConnection.id).all()],
    }


@router.put("/connections/{connection_id}")
def save_capacity(
    connection_id: int,
    data: CapacityConfigIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("sistema.cache")),
):
    """Grava os campos do Azure e a agenda. Campo vazio vira nulo. Gravar nao liga nada: as travas continuam valendo."""
    connection = _get_connection(db, connection_id)
    ranges = []
    for item in data.schedule:
        if not item.days or any(not 0 <= d <= 6 for d in item.days):
            raise HTTPException(status_code=400, detail="Escolha pelo menos um dia da semana em cada faixa.")
        try:
            start, end = parse_clock(item.start, is_end=False), parse_clock(item.end, is_end=True)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        if start == end:
            raise HTTPException(status_code=400, detail="O inicio e o fim da faixa nao podem ser iguais.")
        ranges.append({"days": sorted(set(item.days)), "start": item.start, "end": item.end})
    for field in ("azure_subscription_id", "azure_resource_group", "azure_capacity_name"):
        value = (getattr(data, field) or "").strip()
        setattr(connection, field, value or None)
    connection.capacity_real_calls = data.capacity_real_calls
    connection.capacity_schedule_enabled = data.capacity_schedule_enabled
    connection.capacity_schedule_json = json.dumps(ranges) if ranges else None
    db.commit()
    log_action(
        db, action="capacity_config", entity="powerbi_connection", user_id=current_user.id, entity_id=connection.id,
        details=f"{connection.name}: {'real' if connection.capacity_real_calls else 'simulado'}, agenda {'ligada' if connection.capacity_schedule_enabled else 'desligada'}",
    )
    return _config_out(db, connection)


@router.post("/connections/{connection_id}/{action}")
def manual_action(
    connection_id: int,
    action: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("sistema.cache")),
):
    """O botao manual: `suspend` (pausar) ou `resume` (retomar). Recusa com 409 se alguma trava estiver fechada."""
    if action not in azure_capacity.ACTIONS:
        raise HTTPException(status_code=404, detail="Acao desconhecida")
    connection = _get_connection(db, connection_id)
    try:
        result = azure_capacity.run_action(db, connection, action, actor_id=current_user.id, source="manual")
    except azure_capacity.CapacityError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return {**_config_out(db, connection), "mode": result["mode"]}

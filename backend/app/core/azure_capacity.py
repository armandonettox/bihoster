"""Pausar e retomar a capacidade do Power BI (Azure) por horario ou por botao (v1.54.0).

TUDO DESLIGADO POR PADRAO, em tres travas que precisam estar abertas ao mesmo tempo:
1. a chave geral "Permitir controle da capacidade" em Administracao (`app_settings.capacity_control_enabled`);
2. os tres campos do Azure da conta preenchidos (assinatura, grupo de recursos e nome da capacidade);
3. para chamar o Azure DE VERDADE, `capacity_real_calls` = True na conta. Nulo ou False e o modo SIMULADO: so registra o que
   faria (estado e auditoria), sem rede nenhuma.

A chamada real usa o mesmo Service Principal da conta (escopo do Azure Resource Manager) e a API
`Microsoft.PowerBIDedicated/capacities/{nome}/suspend|resume`. Os testes nunca falam com o Azure: a rede fica bloqueada
(`_BLOCK_NETWORK`) e so um cliente HTTP simulado injetado passa."""

import json
import logging
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.core.access_schedule import now_utc, parse_clock, parse_days, ranges_allow
from app.core.audit import log_action
from app.core.audit_filters import system_tz
from app.core.powerbi import AAD_TOKEN_URL
from app.models.powerbi_connection import PowerBIConnection
from app.models.settings import AppSettings

logger = logging.getLogger(__name__)

AZURE_SCOPE = "https://management.azure.com/.default"
API_VERSION = "2021-01-01"
ACTIONS = {"suspend": "paused", "resume": "running"}
# Os testes ligam isto: sem cliente HTTP injetado, a chamada real e recusada
_BLOCK_NETWORK = False


class CapacityError(Exception):
    """Erro de uma acao na capacidade, com mensagem para a tela."""


def master_switch_on(db: Session) -> bool:
    row = db.query(AppSettings).filter(AppSettings.id == 1).first()
    return bool(row and row.capacity_control_enabled)


def is_configured(connection: PowerBIConnection) -> bool:
    return bool(connection.azure_subscription_id and connection.azure_resource_group and connection.azure_capacity_name)


def is_simulated(connection: PowerBIConnection) -> bool:
    """Qualquer coisa diferente de True explicito e simulado."""
    return connection.capacity_real_calls is not True


def capacity_url(connection: PowerBIConnection, action: str) -> str:
    return (
        "https://management.azure.com/subscriptions/"
        f"{connection.azure_subscription_id}/resourceGroups/{connection.azure_resource_group}"
        f"/providers/Microsoft.PowerBIDedicated/capacities/{connection.azure_capacity_name}/{action}?api-version={API_VERSION}"
    )


def _real_call(connection: PowerBIConnection, action: str, http_client: Optional[httpx.Client] = None) -> None:
    if http_client is None and _BLOCK_NETWORK:
        raise CapacityError("Chamada real ao Azure bloqueada neste ambiente.")
    client = http_client or httpx.Client(timeout=30)
    try:
        token_response = client.post(
            AAD_TOKEN_URL.format(tenant_id=connection.tenant_id),
            data={
                "grant_type": "client_credentials",
                "client_id": connection.client_id,
                "client_secret": connection.client_secret,
                "scope": AZURE_SCOPE,
            },
        )
        if token_response.status_code != 200:
            raise CapacityError("O Azure recusou a autenticacao da conta.")
        token = token_response.json().get("access_token")
        if not token:
            raise CapacityError("O Azure nao devolveu um token.")
        response = client.post(capacity_url(connection, action), headers={"Authorization": f"Bearer {token}"})
        if response.status_code not in (200, 202):
            raise CapacityError(f"O Azure recusou a acao (HTTP {response.status_code}).")
    except httpx.HTTPError as exc:
        raise CapacityError("Nao foi possivel falar com o Azure.") from exc
    finally:
        if http_client is None:
            client.close()


def run_action(
    db: Session,
    connection: PowerBIConnection,
    action: str,
    *,
    actor_id: Optional[int] = None,
    source: str = "manual",
    http_client: Optional[httpx.Client] = None,
) -> dict:
    """Pausa (`suspend`) ou retoma (`resume`) a capacidade da conta. Confere as tres travas, registra o novo estado e audita."""
    if action not in ACTIONS:
        raise CapacityError("Acao invalida.")
    if not master_switch_on(db):
        raise CapacityError("O controle da capacidade esta desligado em Administracao.")
    if not is_configured(connection):
        raise CapacityError("Preencha assinatura, grupo de recursos e nome da capacidade da conta antes.")
    simulated = is_simulated(connection)
    if not simulated:
        _real_call(connection, action, http_client)
    connection.capacity_state = ACTIONS[action]
    connection.capacity_state_at = now_utc()
    db.commit()
    log_action(
        db, action=f"capacity_{action}", entity="powerbi_connection", user_id=actor_id, entity_id=connection.id,
        details=f"{connection.name}: {'simulado' if simulated else 'real'}, origem {source}",
    )
    return {"state": connection.capacity_state, "mode": "simulated" if simulated else "real", "at": connection.capacity_state_at}


def parse_schedule(text: Optional[str]) -> list:
    """As faixas em que a capacidade deve ficar LIGADA, como objetos para `ranges_allow`. Texto ruim vale como sem faixas."""
    try:
        raw = json.loads(text or "[]")
        return [
            SimpleNamespace(
                days=",".join(str(d) for d in sorted(parse_days(",".join(str(d) for d in item["days"])))),
                start_minute=parse_clock(item["start"], is_end=False),
                end_minute=parse_clock(item["end"], is_end=True),
            )
            for item in raw
        ]
    except (ValueError, KeyError, TypeError):
        return []


def desired_state(connection: PowerBIConnection, local_now: datetime) -> Optional[str]:
    """"running" dentro das faixas, "paused" fora delas; None se a agenda esta desligada ou sem faixas."""
    if not connection.capacity_schedule_enabled:
        return None
    ranges = parse_schedule(connection.capacity_schedule_json)
    if not ranges:
        return None
    return "running" if ranges_allow(ranges, local_now) else "paused"


def tick(db: Session, now: Optional[datetime] = None, http_client: Optional[httpx.Client] = None) -> list[dict]:
    """Uma rodada da agenda: so age quando o estado desejado muda do ultimo registrado. Chave geral desligada = nada acontece.
    Erro numa conta e registrado e nao impede as outras."""
    if not master_switch_on(db):
        return []
    tz, _ = system_tz(db)
    local_now = (now or now_utc()).astimezone(tz)
    done = []
    for connection in db.query(PowerBIConnection).all():
        if not is_configured(connection):
            continue
        wanted = desired_state(connection, local_now)
        if wanted is None or wanted == connection.capacity_state:
            continue
        action = "resume" if wanted == "running" else "suspend"
        try:
            result = run_action(db, connection, action, source="agenda", http_client=http_client)
            done.append({"connection_id": connection.id, "action": action, **result})
        except CapacityError as exc:
            logger.warning("capacidade: conta %s, %s falhou (%s)", connection.id, action, exc)
            db.rollback()
    return done


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

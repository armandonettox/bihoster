from datetime import datetime, timedelta, timezone
from typing import Optional, TypeVar

import httpx

from app.models.powerbi_connection import PowerBIConnection

_T = TypeVar("_T")


def prune_expired(cache: dict[tuple, tuple[datetime, _T]]) -> None:
    """Remove entradas vencidas antes de ler/escrever -- sem isso os caches cresceriam pra
    sempre num processo de longa duracao, ja que so eram limpos por invalidacao explicita.
    Compartilhado entre todos os caches em memoria de chamadas ao Power BI (embed token,
    refresh info, catalogo de workspaces/relatorios)."""
    now = datetime.now(timezone.utc)
    for key in [k for k, (expires_at, _) in cache.items() if expires_at <= now]:
        # pop (nao del) -- outra requisicao concorrente pode ja ter removido essa mesma
        # chave (invalidacao ou outra pruning rodando ao mesmo tempo na threadpool).
        cache.pop(key, None)

AAD_TOKEN_URL = "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
POWERBI_API_BASE = "https://api.powerbi.com/v1.0/myorg"
POWERBI_SCOPE = "https://analysis.windows.net/powerbi/api/.default"

# Cache simples em memoria do token de cada conta Power BI (Service Principal), por connection_id --
# guarda tambem o client_id usado pra nao servir um token velho apos a conta ser reconfigurada.
_cached_tokens: dict[int, tuple[str, str, datetime]] = {}  # connection_id -> (token, client_id, expires_at)


class PowerBIError(Exception):
    pass


def invalidate_token_cache(connection_id: int) -> None:
    """Chamado ao editar/excluir uma conta -- tira o token em cache pra nao continuar usando
    credenciais trocadas/removidas, e evita a entrada ficar presa em memoria para sempre."""
    _cached_tokens.pop(connection_id, None)


def _error_detail(response: httpx.Response) -> str:
    """O corpo da resposta de erro da API do Power BI costuma vir vazio -- o detalhe
    real fica no header x-powerbi-error-info (ex: ServicePrincipalIsNotAllowedByTenantAdminSwitch)."""
    detail = response.text.strip()
    header_info = response.headers.get("x-powerbi-error-info")
    if header_info:
        detail = f"{detail} {header_info}".strip()
    return f"HTTP {response.status_code} -- {detail or 'sem detalhes na resposta'}"


def _get_aad_token(connection: PowerBIConnection) -> str:
    cached = _cached_tokens.get(connection.id)
    if cached:
        token, client_id, expires_at = cached
        if client_id == connection.client_id and datetime.now(timezone.utc) < expires_at:
            return token

    url = AAD_TOKEN_URL.format(tenant_id=connection.tenant_id)
    data = {
        "grant_type": "client_credentials",
        "client_id": connection.client_id,
        "client_secret": connection.client_secret,
        "scope": POWERBI_SCOPE,
    }

    response = httpx.post(url, data=data, timeout=30)
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao autenticar na Azure AD: {_error_detail(response)}")

    payload = response.json()
    # Da uma margem de seguranca de 60s antes do token expirar de verdade
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=payload["expires_in"] - 60)
    _cached_tokens[connection.id] = (payload["access_token"], connection.client_id, expires_at)
    return payload["access_token"]


def _headers(connection: PowerBIConnection) -> dict:
    return {"Authorization": f"Bearer {_get_aad_token(connection)}"}


def list_workspaces(connection: PowerBIConnection) -> list[dict]:
    """Lista os workspaces (grupos) do Power BI que a service principal enxerga."""
    url = f"{POWERBI_API_BASE}/groups?$top=200"
    response = httpx.get(url, headers=_headers(connection), timeout=30)
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao listar workspaces do Power BI: {_error_detail(response)}")
    return response.json().get("value", [])


def list_reports(connection: PowerBIConnection, workspace_id: str) -> list[dict]:
    """Lista os relatorios publicados num workspace do Power BI."""
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/reports"
    response = httpx.get(url, headers=_headers(connection), timeout=30)
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao listar relatorios do Power BI: {_error_detail(response)}")
    return response.json().get("value", [])


def get_report_details(connection: PowerBIConnection, workspace_id: str, report_id: str) -> dict:
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/reports/{report_id}"
    response = httpx.get(url, headers=_headers(connection), timeout=30)
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao buscar relatorio no Power BI: {_error_detail(response)}")
    return response.json()


def dataset_requires_effective_identity(connection: PowerBIConnection, workspace_id: str, dataset_id: str) -> bool:
    """So dataset com RLS configurado aceita (e exige) identidade efetiva no GenerateToken --
    mandar identidade para um dataset sem RLS faz a API rejeitar a chamada."""
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/datasets/{dataset_id}"
    response = httpx.get(url, headers=_headers(connection), timeout=30)
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao buscar dataset no Power BI: {_error_detail(response)}")
    return bool(response.json().get("isEffectiveIdentityRequired"))


def generate_embed_token(
    connection: PowerBIConnection,
    workspace_id: str,
    report_id: str,
    dataset_id: Optional[str] = None,
    username: Optional[str] = None,
    roles: Optional[list[str]] = None,
) -> dict:
    """Gera o embed token para o relatorio, com suporte a Row-Level Security.

    Quando username/roles sao informados, o token e gerado com identidade
    efetiva para aplicar o RLS configurado no dataset do Power BI.
    """
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/reports/{report_id}/GenerateToken"
    body: dict = {"accessLevel": "View"}

    if username and dataset_id:
        body["identities"] = [
            {
                "username": username,
                "roles": roles or [],
                "datasets": [dataset_id],
            }
        ]

    response = httpx.post(url, headers=_headers(connection), json=body, timeout=30)
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao gerar embed token: {_error_detail(response)}")
    return response.json()


def refresh_dataset(connection: PowerBIConnection, workspace_id: str, dataset_id: str) -> None:
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/datasets/{dataset_id}/refreshes"
    response = httpx.post(url, headers=_headers(connection), timeout=30)
    if response.status_code != 202:
        raise PowerBIError(f"Falha ao iniciar atualizacao do dataset: {_error_detail(response)}")


def get_refresh_history(connection: PowerBIConnection, workspace_id: str, dataset_id: str, top: int = 10) -> list[dict]:
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/datasets/{dataset_id}/refreshes?$top={top}"
    response = httpx.get(url, headers=_headers(connection), timeout=30)
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao buscar historico de atualizacao: {_error_detail(response)}")
    return response.json().get("value", [])


_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


def _next_scheduled_refresh(schedule: dict) -> Optional[datetime]:
    """So funciona pra dataset em capacidade compartilhada com agendamento habilitado --
    Premium ou sem agendamento nao tem essa info, e a API responde vazio/erro nesses casos."""
    if not schedule.get("enabled"):
        return None

    days = schedule.get("days") or []
    times = schedule.get("times") or []
    if not days or not times:
        return None

    now = datetime.now(timezone.utc)
    candidates: list[datetime] = []
    for day_offset in range(8):
        candidate_day = now + timedelta(days=day_offset)
        # Python weekday(): Monday=0..Sunday=6 -- ajusta pro nome do dia em ingles usado pela API.
        weekday_name = _WEEKDAYS[(candidate_day.weekday() + 1) % 7]
        if weekday_name not in days:
            continue
        for time_str in times:
            hour, minute = (int(part) for part in time_str.split(":"))
            candidate = candidate_day.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if candidate > now:
                candidates.append(candidate)

    return min(candidates) if candidates else None


def get_refresh_schedule(connection: PowerBIConnection, workspace_id: str, dataset_id: str) -> Optional[dict]:
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/datasets/{dataset_id}/refreshSchedule"
    response = httpx.get(url, headers=_headers(connection), timeout=30)
    if response.status_code != 200:
        return None
    return response.json()


def get_refresh_info(connection: PowerBIConnection, workspace_id: str, dataset_id: str) -> dict:
    """Combina ultima atualizacao (historico) e proxima (agendamento) num unico resultado --
    qualquer uma que nao estiver disponivel vem como None em vez de dar erro."""
    last_refresh = None
    try:
        history = get_refresh_history(connection, workspace_id, dataset_id, top=1)
        completed = [h for h in history if h.get("status") == "Completed" and h.get("endTime")]
        if completed:
            last_refresh = completed[0]["endTime"]
    except PowerBIError:
        pass

    next_refresh = None
    schedule = get_refresh_schedule(connection, workspace_id, dataset_id)
    if schedule:
        next_dt = _next_scheduled_refresh(schedule)
        if next_dt:
            next_refresh = next_dt.isoformat()

    return {"last_refresh": last_refresh, "next_refresh": next_refresh}

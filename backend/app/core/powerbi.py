import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional, TypeVar

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

# Cliente HTTP unico, compartilhado por todas as chamadas ao Power BI e a Azure AD. `httpx.get`/
# `httpx.post` soltos criam um cliente novo a cada chamada, entao cada uma abria conexao TCP e
# fazia o handshake TLS de novo (varias centenas de ms por chamada). Com o cliente compartilhado
# a conexao fica aberta (keep-alive) e as chamadas seguintes reaproveitam. E seguro entre threads:
# os endpoints sincronos rodam na threadpool do FastAPI.
_http = httpx.Client(
    timeout=30,
    limits=httpx.Limits(max_connections=40, max_keepalive_connections=20, keepalive_expiry=60),
)

# Cache simples em memoria do token de cada conta Power BI (Service Principal), por connection_id --
# guarda tambem o client_id usado pra nao servir um token velho apos a conta ser reconfigurada.
_cached_tokens: dict[int, tuple[str, str, datetime]] = {}  # connection_id -> (token, client_id, expires_at)
# Varias requisicoes ao mesmo tempo (busca em paralelo, aquecimento de cache) com o token vencido
# pediriam o mesmo token a Azure AD cada uma. O trinco faz so a primeira pedir; as outras esperam e
# reaproveitam o resultado.
_aad_lock = threading.Lock()


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


def _valid_cached_token(connection: PowerBIConnection) -> Optional[str]:
    cached = _cached_tokens.get(connection.id)
    if cached:
        token, client_id, expires_at = cached
        if client_id == connection.client_id and datetime.now(timezone.utc) < expires_at:
            return token
    return None


def _get_aad_token(connection: PowerBIConnection) -> str:
    token = _valid_cached_token(connection)
    if token:
        return token
    with _aad_lock:
        # Quem esperou o trinco pode encontrar o token ja renovado por outra thread
        token = _valid_cached_token(connection)
        if token:
            return token
        return _request_aad_token(connection)


def _request_aad_token(connection: PowerBIConnection) -> str:
    url = AAD_TOKEN_URL.format(tenant_id=connection.tenant_id)
    data = {
        "grant_type": "client_credentials",
        "client_id": connection.client_id,
        "client_secret": connection.client_secret,
        "scope": POWERBI_SCOPE,
    }

    response = _http.post(url, data=data)
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
    response = _http.get(url, headers=_headers(connection))
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao listar workspaces do Power BI: {_error_detail(response)}")
    return response.json().get("value", [])


def list_reports(connection: PowerBIConnection, workspace_id: str) -> list[dict]:
    """Lista os relatorios publicados num workspace do Power BI."""
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/reports"
    response = _http.get(url, headers=_headers(connection))
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao listar relatorios do Power BI: {_error_detail(response)}")
    return response.json().get("value", [])


def get_report_details(connection: PowerBIConnection, workspace_id: str, report_id: str) -> dict:
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/reports/{report_id}"
    response = _http.get(url, headers=_headers(connection))
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao buscar relatorio no Power BI: {_error_detail(response)}")
    return response.json()


def list_pages(connection: PowerBIConnection, workspace_id: str, report_id: str) -> list[dict]:
    """Lista as paginas (abas) publicadas dentro de um relatorio -- usado pra deixar escolher
    so uma aba especifica em vez do relatorio inteiro ao adicionar numa colecao."""
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/reports/{report_id}/pages"
    response = _http.get(url, headers=_headers(connection))
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao listar paginas do relatorio no Power BI: {_error_detail(response)}")
    return response.json().get("value", [])


def execute_dax_query(connection: PowerBIConnection, workspace_id: str, dataset_id: str, dax: str) -> list[dict]:
    """Executa uma query DAX contra um dataset e devolve as linhas como lista de dicts.
    Usa a API executeQueries do Power BI (requer capacidade dedicada ou Fabric)."""
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/datasets/{dataset_id}/executeQueries"
    body = {"queries": [{"query": dax}], "serializerSettings": {"includeNulls": True}}
    response = _http.post(url, headers=_headers(connection), json=body)
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao executar query DAX: {_error_detail(response)}")
    results = response.json().get("results", [])
    if not results:
        return []
    tables = results[0].get("tables", [])
    return tables[0].get("rows", []) if tables else []


def list_measures(connection: PowerBIConnection, workspace_id: str, dataset_id: str) -> list[dict]:
    """Lista as medidas do dataset via INFO.MEASURES() (requer executeQueries habilitado no tenant).
    Devolve lista de dicts com 'measure_name' e 'table_name'."""
    rows = execute_dax_query(
        connection,
        workspace_id,
        dataset_id,
        "EVALUATE SELECTCOLUMNS(INFO.MEASURES(), \"Name\", [Name], \"TableID\", [TableID])",
    )
    table_rows = execute_dax_query(
        connection,
        workspace_id,
        dataset_id,
        "EVALUATE SELECTCOLUMNS(INFO.TABLES(), \"ID\", [ID], \"Name\", [Name])",
    )
    table_map = {r.get("[ID]"): r.get("[Name]", "") for r in table_rows}
    measures = []
    for row in rows:
        name = row.get("[Name]") or row.get("Name")
        table_id = row.get("[TableID]") or row.get("TableID")
        if name:
            measures.append({"measure_name": name, "table_name": table_map.get(table_id, "")})
    return sorted(measures, key=lambda m: (m["table_name"], m["measure_name"]))


def query_measure_value(
    connection: PowerBIConnection, workspace_id: str, dataset_id: str, dax_expression: str
) -> Optional[float]:
    """Avalia uma expressao DAX e devolve o resultado numerico (ou None se nulo/invalido)."""
    rows = execute_dax_query(
        connection, workspace_id, dataset_id, f"EVALUATE ROW(\"v\", {dax_expression})"
    )
    if not rows:
        return None
    value = next(iter(rows[0].values()), None)
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def dataset_requires_effective_identity(connection: PowerBIConnection, workspace_id: str, dataset_id: str) -> bool:
    """So dataset com RLS configurado aceita (e exige) identidade efetiva no GenerateToken --
    mandar identidade para um dataset sem RLS faz a API rejeitar a chamada."""
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/datasets/{dataset_id}"
    response = _http.get(url, headers=_headers(connection))
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

    response = _http.post(url, headers=_headers(connection), json=body)
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao gerar embed token: {_error_detail(response)}")
    return response.json()


def refresh_dataset(connection: PowerBIConnection, workspace_id: str, dataset_id: str) -> None:
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/datasets/{dataset_id}/refreshes"
    response = _http.post(url, headers=_headers(connection))
    if response.status_code != 202:
        raise PowerBIError(f"Falha ao iniciar atualizacao do dataset: {_error_detail(response)}")


def get_refresh_history(connection: PowerBIConnection, workspace_id: str, dataset_id: str, top: int = 10) -> list[dict]:
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/datasets/{dataset_id}/refreshes?$top={top}"
    response = _http.get(url, headers=_headers(connection))
    if response.status_code != 200:
        raise PowerBIError(f"Falha ao buscar historico de atualizacao: {_error_detail(response)}")
    return response.json().get("value", [])


# --- Exportar relatorio para arquivo (API ExportTo do Power BI) -----------------------------------
# So funciona em capacidade dedicada (Premium, Embedded ou Fabric); sem ela a API responde erro, que
# sobe como PowerBIError com o detalhe devolvido pelo Power BI.

# formato -> (tipo MIME, extensao)
EXPORT_FORMATS = {
    "PDF": ("application/pdf", ".pdf"),
    "PNG": ("image/png", ".png"),
    "PPTX": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"),
}
# Acima disso o arquivo nao cabe como anexo na maioria dos servidores de e-mail
MAX_EXPORT_BYTES = 20 * 1024 * 1024
EXPORT_TIMEOUT_SECONDS = 300
EXPORT_POLL_SECONDS = 3


def start_export(
    connection: PowerBIConnection,
    workspace_id: str,
    report_id: str,
    fmt: str = "PDF",
    page_names: Optional[list[str]] = None,
) -> str:
    """Pede ao Power BI que exporte o relatorio e devolve o id da exportacao. `page_names` limita
    as abas exportadas (vazio = o relatorio inteiro)."""
    if fmt not in EXPORT_FORMATS:
        raise PowerBIError(f"Formato de exportacao desconhecido: {fmt}")
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/reports/{report_id}/ExportTo"
    body: dict = {"format": fmt}
    if page_names:
        body["powerBIReportConfiguration"] = {"pages": [{"pageName": name} for name in page_names]}
    response = _http.post(url, headers=_headers(connection), json=body)
    if response.status_code not in (200, 202):
        raise PowerBIError(f"Falha ao iniciar a exportacao do relatorio: {_error_detail(response)}")
    return response.json()["id"]


def get_export_status(connection: PowerBIConnection, workspace_id: str, report_id: str, export_id: str) -> dict:
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/reports/{report_id}/exports/{export_id}"
    response = _http.get(url, headers=_headers(connection))
    # O Power BI responde 202 enquanto a exportacao roda (com o andamento no corpo) e 200 ao terminar
    if response.status_code not in (200, 202):
        raise PowerBIError(f"Falha ao consultar a exportacao: {_error_detail(response)}")
    return response.json()


def download_export(connection: PowerBIConnection, workspace_id: str, report_id: str, export_id: str) -> bytes:
    """Baixa o arquivo pronto, parando se passar do limite de tamanho (sem carregar tudo na memoria)."""
    url = f"{POWERBI_API_BASE}/groups/{workspace_id}/reports/{report_id}/exports/{export_id}/file"
    chunks: list[bytes] = []
    total = 0
    with _http.stream("GET", url, headers=_headers(connection)) as response:
        if response.status_code != 200:
            response.read()
            raise PowerBIError(f"Falha ao baixar o arquivo exportado: {_error_detail(response)}")
        for chunk in response.iter_bytes():
            total += len(chunk)
            if total > MAX_EXPORT_BYTES:
                raise PowerBIError("O arquivo exportado passa de 20 MB, acima do que um e-mail costuma aceitar.")
            chunks.append(chunk)
    return b"".join(chunks)


def export_report(
    connection: PowerBIConnection,
    workspace_id: str,
    report_id: str,
    fmt: str = "PDF",
    page_names: Optional[list[str]] = None,
    timeout_seconds: float = EXPORT_TIMEOUT_SECONDS,
    poll_seconds: float = EXPORT_POLL_SECONDS,
    on_progress: Optional[Callable[[int], None]] = None,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> bytes:
    """Exporta o relatorio e devolve o arquivo. Espera o Power BI terminar (a exportacao leva de
    segundos a minutos) e para com erro se falhar ou passar de `timeout_seconds`."""
    export_id = start_export(connection, workspace_id, report_id, fmt, page_names)
    deadline = clock() + timeout_seconds
    while True:
        status = get_export_status(connection, workspace_id, report_id, export_id)
        state = status.get("status")
        if on_progress is not None:
            on_progress(int(status.get("percentComplete") or 0))
        if state == "Succeeded":
            return download_export(connection, workspace_id, report_id, export_id)
        if state == "Failed":
            raise PowerBIError("O Power BI nao conseguiu exportar o relatorio (a exportacao falhou).")
        if clock() >= deadline:
            raise PowerBIError("A exportacao demorou demais e foi interrompida.")
        sleep(poll_seconds)


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
    response = _http.get(url, headers=_headers(connection))
    if response.status_code != 200:
        return None
    return response.json()


def get_refresh_info(connection: PowerBIConnection, workspace_id: str, dataset_id: str) -> dict:
    """Combina ultima atualizacao (historico) e proxima (agendamento) num unico resultado --
    qualquer uma que nao estiver disponivel vem como None em vez de dar erro.

    `last_refresh` e o fim da ultima atualizacao CONCLUIDA; `last_status` e o status da tentativa
    mais recente (Completed, Failed, Unknown = em andamento, Disabled...). Quando a ultima tentativa
    falhou, os dois divergem: a data e a do ultimo sucesso e o status mostra a falha. O historico
    vem do mais recente para o mais antigo; 5 entradas bastam pra achar o ultimo sucesso."""
    last_refresh = None
    last_status = None
    try:
        history = get_refresh_history(connection, workspace_id, dataset_id, top=5)
        if history:
            last_status = history[0].get("status")
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

    return {"last_refresh": last_refresh, "next_refresh": next_refresh, "last_status": last_status}

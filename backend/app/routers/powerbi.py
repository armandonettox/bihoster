import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core import powerbi
from app.core.database import get_db
from app.core.db_helpers import get_or_404
from app.core.workspace_deps import require_workspace_member, require_workspace_role
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.user import User, UserRole
from app.schemas.powerbi import EmbedConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces/{workspace_id}/powerbi", tags=["powerbi"])

_prune_expired = powerbi.prune_expired


# Cache simples em memoria do embed token: evita gerar um novo a cada vez que alguem abre o mesmo
# relatorio. A chave e (colecao, relatorio, usuario). Relatorio SEM RLS gera um token igual para
# qualquer pessoa, entao a chave usa `None` no lugar do usuario e todos compartilham a mesma
# entrada; relatorio com RLS guarda um token por usuario, porque a identidade vai dentro dele. Vale
# ate a expiracao real do token menos essa margem, pra nunca entregar um token quase vencido.
_EMBED_CACHE_MARGIN = timedelta(minutes=5)
# Validade assumida quando o Power BI nao informa `expiration` (o embed token dura ~1h)
_EMBED_DEFAULT_LIFETIME = timedelta(minutes=60)
_embed_cache: dict[tuple[int, int, Optional[int]], tuple[datetime, EmbedConfig]] = {}


def _parse_token_expiration(raw: Optional[str]) -> datetime:
    """`expiration` do GenerateToken vem em ISO 8601 UTC (ex: 2026-09-29T20:00:00Z, com fracao de
    segundo de 7 casas). Sem o campo, ou com um valor ilegivel, assume a validade padrao."""
    if raw:
        try:
            cleaned = raw.strip().replace("Z", "+00:00")
            # Python le no maximo 6 casas de fracao de segundo; o Power BI manda 7
            if "." in cleaned:
                head, _, tail = cleaned.partition(".")
                digits = "".join(ch for ch in tail if ch.isdigit())[:6]
                zone = tail[len("".join(ch for ch in tail if ch.isdigit())):]
                cleaned = f"{head}.{digits}{zone}"
            parsed = datetime.fromisoformat(cleaned)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc) + _EMBED_DEFAULT_LIFETIME

# Historico/agendamento de atualizacao do dataset mudam pouco -- cachear alguns minutos evita
# uma chamada ao Power BI por card toda vez que a colecao e aberta (pesa bastante no modo icone).
# A chave e (conta, dataset): varios relatorios costumam usar o mesmo dataset, e a informacao e do
# dataset, nao do relatorio.
_REFRESH_INFO_CACHE_TTL = timedelta(minutes=5)
_refresh_info_cache: dict[tuple[int, str], tuple[datetime, dict]] = {}
_EMPTY_REFRESH_INFO = {"last_refresh": None, "next_refresh": None, "last_status": None}
# Quantos datasets sao consultados ao mesmo tempo na rota em lote
_REFRESH_INFO_WORKERS = 8

# Dados do relatorio que mudam pouco e nao dependem de quem pede: a URL de embed e se o dataset
# exige identidade efetiva (RLS). Sem este cache, cada usuario novo (e cada reinicio do backend)
# refazia duas chamadas ao Power BI por relatorio antes mesmo de gerar o token. O TTL e curto
# porque o RLS pode ser ligado no Power BI; se o token for recusado, a entrada e descartada na hora.
_REPORT_STATIC_CACHE_TTL = timedelta(minutes=30)
_report_static_cache: dict[tuple[int, int], tuple[datetime, dict]] = {}


def invalidate_embed_cache(workspace_id: int, report_id: int) -> None:
    """Chamado ao editar/excluir um relatorio -- tira dos caches pra nao servir dado velho. A info
    de atualizacao e do dataset (nao do relatorio) e tem a propria invalidacao."""
    for key in [k for k in _embed_cache if k[0] == workspace_id and k[1] == report_id]:
        _embed_cache.pop(key, None)
    _report_static_cache.pop((workspace_id, report_id), None)


def invalidate_refresh_info_for_connection(connection_id: int) -> None:
    """Chamado ao editar/excluir uma conta: a info de atualizacao dos datasets dela fica velha."""
    for key in [k for k in _refresh_info_cache if k[0] == connection_id]:
        _refresh_info_cache.pop(key, None)


def _get_report_or_404(db: Session, workspace_id: int, report_id: int) -> Report:
    return get_or_404(db, Report, "Relatorio nao encontrado", id=report_id, collection_id=workspace_id)


def _get_connection_or_error(db: Session, report: Report) -> PowerBIConnection:
    connection = (
        db.query(PowerBIConnection).get(report.powerbi_connection_id) if report.powerbi_connection_id else None
    )
    if not connection:
        raise HTTPException(
            status_code=400, detail="Esse relatorio nao tem uma conta do Power BI configurada -- edite o relatorio e escolha uma"
        )
    return connection


def _get_report_static(connection: PowerBIConnection, workspace_id: int, report: Report) -> dict:
    """URL de embed e exigencia de RLS do relatorio, com cache (ver _REPORT_STATIC_CACHE_TTL)."""
    _prune_expired(_report_static_cache)
    cache_key = (workspace_id, report.id)
    cached = _report_static_cache.get(cache_key)
    if cached:
        return cached[1]

    details = powerbi.get_report_details(connection, report.pbi_workspace_id, report.pbi_report_id)
    needs_identity = bool(report.pbi_dataset_id) and powerbi.dataset_requires_effective_identity(
        connection, report.pbi_workspace_id, report.pbi_dataset_id
    )
    static = {"embed_url": details["embedUrl"], "needs_identity": needs_identity}
    _report_static_cache[cache_key] = (datetime.now(timezone.utc) + _REPORT_STATIC_CACHE_TTL, static)
    return static


def _generate_embed_config(
    connection: PowerBIConnection, workspace_id: int, report: Report, username: Optional[str]
) -> tuple[EmbedConfig, bool]:
    """Gera o embed token e monta a configuracao. Devolve (config, relatorio_exige_identidade).
    `username` so entra no token quando o dataset tem RLS."""
    static = _get_report_static(connection, workspace_id, report)
    needs_identity = static["needs_identity"]
    try:
        token_response = powerbi.generate_embed_token(
            connection,
            workspace_id=report.pbi_workspace_id,
            report_id=report.pbi_report_id,
            dataset_id=report.pbi_dataset_id if needs_identity else None,
            username=username if needs_identity else None,
        )
    except powerbi.PowerBIError:
        # O dado guardado pode estar velho (RLS ligado ou desligado no Power BI): na proxima
        # tentativa busca de novo em vez de repetir o mesmo erro ate o TTL vencer.
        _report_static_cache.pop((workspace_id, report.id), None)
        raise

    expires_at = _parse_token_expiration(token_response.get("expiration"))
    config = EmbedConfig(
        report_id=report.pbi_report_id,
        embed_url=static["embed_url"],
        access_token=token_response["token"],
        page_name=report.pbi_page_name,
        page_names=report.pbi_page_names,
        expires_at=expires_at,
        show_filter_pane=bool(report.show_filter_pane),
        show_page_nav=bool(report.show_page_nav),
    )
    return config, needs_identity


def _store_embed_config(
    workspace_id: int, report_id: int, user_id: int, config: EmbedConfig, needs_identity: bool
) -> None:
    """Guarda o config ate _EMBED_CACHE_MARGIN antes de o token vencer (antes eram 50 min fixos, entao
    o usuario podia receber um token com poucos minutos de vida). Token que ja esta perto do
    vencimento nao entra no cache: a proxima chamada gera outro. Sem RLS a entrada e compartilhada."""
    cache_until = config.expires_at - _EMBED_CACHE_MARGIN
    if cache_until > datetime.now(timezone.utc):
        key = (workspace_id, report_id, user_id if needs_identity else None)
        _embed_cache[key] = (cache_until, config)


def _cached_embed_config(workspace_id: int, report_id: int, user_id: int) -> Optional[EmbedConfig]:
    """Procura primeiro a entrada compartilhada (relatorio sem RLS) e depois a do usuario."""
    for key in ((workspace_id, report_id, None), (workspace_id, report_id, user_id)):
        cached = _embed_cache.get(key)
        if cached:
            return cached[1]
    return None


@router.get("/reports/{report_id}/embed", response_model=EmbedConfig)
def get_embed_config(
    workspace_id: int,
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workspace_member),
):
    # A checagem de que a pessoa pertence a colecao (dependencia acima) e a do relatorio na
    # colecao rodam ANTES de qualquer cache: o token compartilhado nunca chega a quem nao tem acesso.
    report = _get_report_or_404(db, workspace_id, report_id)

    _prune_expired(_embed_cache)
    cached = _cached_embed_config(workspace_id, report_id, current_user.id)
    if cached:
        return cached

    connection = _get_connection_or_error(db, report)

    # PowerBIError propaga pro handler global em main.py (converte pra 502 automaticamente).
    config, needs_identity = _generate_embed_config(connection, workspace_id, report, current_user.email)
    _store_embed_config(workspace_id, report_id, current_user.id, config, needs_identity)
    return config


@router.post("/reports/{report_id}/refresh", status_code=202)
def trigger_refresh(
    workspace_id: int,
    report_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_workspace_role(UserRole.admin, UserRole.editor)),
):
    report = _get_report_or_404(db, workspace_id, report_id)
    if not report.pbi_dataset_id:
        raise HTTPException(status_code=400, detail="Relatorio nao tem dataset_id configurado")
    connection = _get_connection_or_error(db, report)

    powerbi.refresh_dataset(connection, report.pbi_workspace_id, report.pbi_dataset_id)
    _refresh_info_cache.pop((connection.id, report.pbi_dataset_id), None)


@router.get("/reports/{report_id}/refresh-history")
def refresh_history(
    workspace_id: int,
    report_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_workspace_member),
):
    report = _get_report_or_404(db, workspace_id, report_id)
    if not report.pbi_dataset_id:
        raise HTTPException(status_code=400, detail="Relatorio nao tem dataset_id configurado")
    connection = _get_connection_or_error(db, report)

    return powerbi.get_refresh_history(connection, report.pbi_workspace_id, report.pbi_dataset_id)


def _get_dataset_refresh_info(connection, pbi_workspace_id: str, dataset_id: str) -> dict:
    """Ultima e proxima atualizacao do dataset, com cache de _REFRESH_INFO_CACHE_TTL."""
    _prune_expired(_refresh_info_cache)
    cache_key = (connection.id, dataset_id)
    cached = _refresh_info_cache.get(cache_key)
    if cached:
        return cached[1]
    info = powerbi.get_refresh_info(connection, pbi_workspace_id, dataset_id)
    _refresh_info_cache[cache_key] = (datetime.now(timezone.utc) + _REFRESH_INFO_CACHE_TTL, info)
    return info


@router.get("/reports/{report_id}/refresh-info")
def refresh_info(
    workspace_id: int,
    report_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_workspace_member),
):
    report = _get_report_or_404(db, workspace_id, report_id)
    if not report.pbi_dataset_id or not report.powerbi_connection_id:
        return dict(_EMPTY_REFRESH_INFO)

    connection = _get_connection_or_error(db, report)
    return _get_dataset_refresh_info(connection, report.pbi_workspace_id, report.pbi_dataset_id)


def _connection_snapshot(connection: PowerBIConnection) -> SimpleNamespace:
    """Copia so o que as chamadas ao Power BI usam, pra outras threads nao tocarem na sessao do banco."""
    return SimpleNamespace(
        id=connection.id,
        tenant_id=connection.tenant_id,
        client_id=connection.client_id,
        client_secret=connection.client_secret,
    )


@router.get("/refresh-info")
def collection_refresh_info(
    workspace_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_workspace_member),
):
    """Ultima/proxima atualizacao de TODOS os relatorios da colecao numa chamada so. A tela de
    colecao antes fazia uma requisicao por card; aqui cada dataset e consultado no maximo uma vez
    (varios relatorios dividem o mesmo), em paralelo, e o resultado fica no cache por dataset."""
    reports = db.query(Report).filter(Report.collection_id == workspace_id).all()
    _prune_expired(_refresh_info_cache)

    wanted: dict[tuple[int, str], str] = {}  # (conta, dataset) -> workspace do Power BI
    for report in reports:
        if report.pbi_dataset_id and report.powerbi_connection_id:
            wanted.setdefault((report.powerbi_connection_id, report.pbi_dataset_id), report.pbi_workspace_id)

    missing = {key: pbi_ws for key, pbi_ws in wanted.items() if key not in _refresh_info_cache}
    if missing:
        connections = {
            c.id: _connection_snapshot(c)
            for c in db.query(PowerBIConnection).filter(PowerBIConnection.id.in_(list({k[0] for k in missing}))).all()
        }
        _fetch_refresh_infos(
            [(connections[key[0]], pbi_ws, key[1]) for key, pbi_ws in missing.items() if key[0] in connections]
        )

    result = {}
    for report in reports:
        info = None
        if report.pbi_dataset_id and report.powerbi_connection_id:
            cached = _refresh_info_cache.get((report.powerbi_connection_id, report.pbi_dataset_id))
            info = cached[1] if cached else None
        result[str(report.id)] = info or dict(_EMPTY_REFRESH_INFO)
    return result


def _fetch_refresh_infos(items: list[tuple]) -> None:
    """Busca em paralelo a info de atualizacao de (conta, workspace do Power BI, dataset) e guarda
    no cache. Uma falha derruba so aquele dataset: ele fica sem info e nao entra no cache."""

    def fetch(item):
        connection, pbi_workspace_id, dataset_id = item
        try:
            info = powerbi.get_refresh_info(connection, pbi_workspace_id, dataset_id)
        except Exception:  # noqa: BLE001 -- uma conta/dataset com problema nao pode derrubar a colecao
            logger.warning("info de atualizacao indisponivel para o dataset %s", dataset_id)
            return
        _refresh_info_cache[(connection.id, dataset_id)] = (
            datetime.now(timezone.utc) + _REFRESH_INFO_CACHE_TTL,
            info,
        )

    if not items:
        return
    with ThreadPoolExecutor(max_workers=min(_REFRESH_INFO_WORKERS, len(items))) as pool:
        list(pool.map(fetch, items))


def warm_report(connection, workspace_id: int, report: Report, renew_before: timedelta) -> bool:
    """Deixa pronto em cache o que a primeira pessoa a abrir o relatorio teria de buscar: dados
    estaticos e, sem RLS, o embed token compartilhado. Renova o que vence em menos de `renew_before`,
    pra nunca haver um intervalo com o cache vazio. Relatorio com RLS nao tem token compartilhado.
    Devolve True se gerou um token novo."""
    now = datetime.now(timezone.utc)
    static_key = (workspace_id, report.id)
    static_entry = _report_static_cache.get(static_key)
    if static_entry and static_entry[0] - now < renew_before:
        _report_static_cache.pop(static_key, None)

    static = _get_report_static(connection, workspace_id, report)
    if static["needs_identity"]:
        return False

    shared = _embed_cache.get((workspace_id, report.id, None))
    if shared and shared[0] - now >= renew_before:
        return False

    config, needs_identity = _generate_embed_config(connection, workspace_id, report, None)
    _store_embed_config(workspace_id, report.id, 0, config, needs_identity)
    return True


def warm_dataset_refresh_info(connection, pbi_workspace_id: str, dataset_id: str, renew_before: timedelta) -> None:
    """Mantem a info de atualizacao do dataset em cache, renovando o que vence em breve."""
    entry = _refresh_info_cache.get((connection.id, dataset_id))
    if entry and entry[0] - datetime.now(timezone.utc) >= renew_before:
        return
    _refresh_info_cache.pop((connection.id, dataset_id), None)
    _get_dataset_refresh_info(connection, pbi_workspace_id, dataset_id)

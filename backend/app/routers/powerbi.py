from datetime import datetime, timedelta, timezone
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

router = APIRouter(prefix="/workspaces/{workspace_id}/powerbi", tags=["powerbi"])

_prune_expired = powerbi.prune_expired


# Cache simples em memoria do embed token por (colecao, relatorio, usuario): evita gerar um novo
# a cada vez que o usuario reabre o mesmo relatorio. Vale ate a expiracao real do token menos
# essa margem, pra nunca entregar um token quase vencido.
_EMBED_CACHE_MARGIN = timedelta(minutes=5)
# Validade assumida quando o Power BI nao informa `expiration` (o embed token dura ~1h)
_EMBED_DEFAULT_LIFETIME = timedelta(minutes=60)
_embed_cache: dict[tuple[int, int, int], tuple[datetime, EmbedConfig]] = {}


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
_REFRESH_INFO_CACHE_TTL = timedelta(minutes=5)
_refresh_info_cache: dict[tuple[int, int], tuple[datetime, dict]] = {}


def invalidate_embed_cache(workspace_id: int, report_id: int) -> None:
    """Chamado ao editar/excluir um relatorio -- tira dos dois caches pra nao servir dado velho."""
    for key in [k for k in _embed_cache if k[0] == workspace_id and k[1] == report_id]:
        _embed_cache.pop(key, None)
    _refresh_info_cache.pop((workspace_id, report_id), None)


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


@router.get("/reports/{report_id}/embed", response_model=EmbedConfig)
def get_embed_config(
    workspace_id: int,
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workspace_member),
):
    report = _get_report_or_404(db, workspace_id, report_id)

    _prune_expired(_embed_cache)
    cache_key = (workspace_id, report_id, current_user.id)
    cached = _embed_cache.get(cache_key)
    if cached:
        return cached[1]

    connection = _get_connection_or_error(db, report)

    # PowerBIError propaga pro handler global em main.py (converte pra 502 automaticamente).
    details = powerbi.get_report_details(connection, report.pbi_workspace_id, report.pbi_report_id)

    needs_identity = bool(report.pbi_dataset_id) and powerbi.dataset_requires_effective_identity(
        connection, report.pbi_workspace_id, report.pbi_dataset_id
    )
    token_response = powerbi.generate_embed_token(
        connection,
        workspace_id=report.pbi_workspace_id,
        report_id=report.pbi_report_id,
        dataset_id=report.pbi_dataset_id if needs_identity else None,
        username=current_user.email if needs_identity else None,
    )

    expires_at = _parse_token_expiration(token_response.get("expiration"))
    config = EmbedConfig(
        report_id=report.pbi_report_id,
        embed_url=details["embedUrl"],
        access_token=token_response["token"],
        page_name=report.pbi_page_name,
        expires_at=expires_at,
    )
    # O cache vale ate _EMBED_CACHE_MARGIN antes de o token vencer (antes eram 50 min fixos, entao
    # o usuario podia receber um token com poucos minutos de vida). Token que ja esta perto do
    # vencimento nao entra no cache: a proxima chamada gera outro.
    cache_until = expires_at - _EMBED_CACHE_MARGIN
    if cache_until > datetime.now(timezone.utc):
        _embed_cache[cache_key] = (cache_until, config)
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
    _refresh_info_cache.pop((workspace_id, report_id), None)


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


@router.get("/reports/{report_id}/refresh-info")
def refresh_info(
    workspace_id: int,
    report_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_workspace_member),
):
    report = _get_report_or_404(db, workspace_id, report_id)
    if not report.pbi_dataset_id or not report.powerbi_connection_id:
        return {"last_refresh": None, "next_refresh": None}

    _prune_expired(_refresh_info_cache)
    cache_key = (workspace_id, report_id)
    cached = _refresh_info_cache.get(cache_key)
    if cached:
        return cached[1]

    connection = _get_connection_or_error(db, report)
    info = powerbi.get_refresh_info(connection, report.pbi_workspace_id, report.pbi_dataset_id)
    _refresh_info_cache[cache_key] = (datetime.now(timezone.utc) + _REFRESH_INFO_CACHE_TTL, info)
    return info

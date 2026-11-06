"""Aquecimento dos caches do Power BI em segundo plano.

Os caches de embed token, dados do relatorio e info de atualizacao vivem so na memoria do
processo: um deploy ou reinicio os esvazia, e a primeira pessoa a abrir uma colecao esperava
dezenas de chamadas ao Power BI. Esta tarefa enche os caches logo depois que o backend sobe e os
renova antes de vencerem, entao ninguem pega o cache vazio. As configuracoes (habilitado/intervalo)
podem ser alteradas pela tela de Configuracoes > Cache; ao salvar, `restart()` relanca a tarefa
com os novos valores sem reiniciar o container.

So existe uma instancia desta tarefa porque o backend roda com um unico worker (ver Dockerfile)."""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from datetime import timedelta
from typing import Optional

from app.core.config import settings as env_settings

# Alias publico para os testes conseguirem fazer patch.object(cache_warmup.settings, ...)
settings = env_settings

logger = logging.getLogger(__name__)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s:     %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

_WORKERS = 4
_RENEW_EXTRA = timedelta(seconds=60)
_MIN_INTERVAL_SECONDS = 30

_stop = threading.Event()
_thread: Optional[threading.Thread] = None
_lock = threading.Lock()

# Ultimo resultado registrado -- lido pelo endpoint de stats
_last_run_at: Optional[datetime] = None
_last_run_stats: dict = {}


def _load_db_settings() -> tuple[bool, int]:
    """Le as configuracoes de cache do banco; cai no env var se nao houver linha no banco."""
    try:
        from app.core.database import SessionLocal
        from app.models.settings import AppSettings
        db = SessionLocal()
        try:
            row = db.query(AppSettings).filter(AppSettings.id == 1).first()
            if row:
                enabled = bool(row.cache_warmup_enabled) if row.cache_warmup_enabled is not None else settings.cache_warmup_enabled
                interval = row.cache_warmup_interval_seconds if row.cache_warmup_interval_seconds is not None else settings.cache_warmup_interval_seconds
                return enabled, interval
        finally:
            db.close()
    except Exception:
        pass
    return settings.cache_warmup_enabled, settings.cache_warmup_interval_seconds


def warm_once(renew_before: timedelta) -> dict:
    """Um ciclo de aquecimento: relatorios (dados estaticos e token compartilhado) e info de
    atualizacao dos datasets. Falha de um item e registrada e nao interrompe os outros."""
    from app.core.database import SessionLocal
    from app.models.powerbi_connection import PowerBIConnection
    from app.models.report import Report
    from app.routers import powerbi as embed_router

    db = SessionLocal()
    try:
        reports = db.query(Report).filter(Report.powerbi_connection_id.isnot(None)).all()
        connections = {c.id: embed_router._connection_snapshot(c) for c in db.query(PowerBIConnection).all()}
    finally:
        db.close()

    def warm_report(report) -> Optional[bool]:
        connection = connections.get(report.powerbi_connection_id)
        if connection is None:
            return None
        try:
            return embed_router.warm_report(connection, report.collection_id, report, renew_before)
        except Exception as exc:  # noqa: BLE001
            logger.warning("aquecimento: relatorio %s falhou (%s)", report.id, str(exc)[:200])
            return None

    datasets: dict[tuple[int, str], str] = {}
    for report in reports:
        if report.pbi_dataset_id:
            datasets.setdefault((report.powerbi_connection_id, report.pbi_dataset_id), report.pbi_workspace_id)

    def warm_dataset(item) -> bool:
        (connection_id, dataset_id), pbi_workspace_id = item
        connection = connections.get(connection_id)
        if connection is None:
            return False
        try:
            embed_router.warm_dataset_refresh_info(connection, pbi_workspace_id, dataset_id, renew_before)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("aquecimento: dataset %s falhou (%s)", dataset_id, str(exc)[:200])
            return False

    with ThreadPoolExecutor(max_workers=_WORKERS) as pool:
        report_results = list(pool.map(warm_report, reports))
        dataset_results = list(pool.map(warm_dataset, datasets.items()))

    return {
        "relatorios": len(reports),
        "tokens_novos": sum(1 for r in report_results if r is True),
        "datasets": len(datasets),
        "erros": sum(1 for r in report_results if r is None) + sum(1 for r in dataset_results if not r),
    }


def _run() -> None:
    global _last_run_at, _last_run_stats
    enabled, interval = _load_db_settings()
    if not enabled:
        return
    interval = max(_MIN_INTERVAL_SECONDS, interval)
    renew_before = timedelta(seconds=interval) + _RENEW_EXTRA

    # Ciclo imediato ao iniciar -- nao espera o primeiro intervalo
    try:
        stats = warm_once(renew_before)
        _last_run_at = datetime.now(timezone.utc)
        _last_run_stats = stats
        logger.info(
            "aquecimento de cache: %(relatorios)s relatorios, %(tokens_novos)s tokens novos, "
            "%(datasets)s datasets, %(erros)s erros",
            stats,
        )
    except Exception:  # noqa: BLE001
        logger.exception("aquecimento de cache falhou no ciclo inicial")

    while not _stop.is_set():
        _stop.wait(interval)
        if _stop.is_set():
            break
        try:
            stats = warm_once(renew_before)
            _last_run_at = datetime.now(timezone.utc)
            _last_run_stats = stats
            logger.info(
                "aquecimento de cache: %(relatorios)s relatorios, %(tokens_novos)s tokens novos, "
                "%(datasets)s datasets, %(erros)s erros",
                stats,
            )
        except Exception:  # noqa: BLE001
            logger.exception("aquecimento de cache falhou")


def start() -> None:
    """Inicia a tarefa em segundo plano (uma so), se estiver habilitada."""
    global _thread
    enabled, _ = _load_db_settings()
    if not enabled:
        return
    with _lock:
        if _thread is not None and _thread.is_alive():
            return
        _stop.clear()
        _thread = threading.Thread(target=_run, name="cache-warmup", daemon=True)
        _thread.start()


def stop() -> None:
    _stop.set()


def restart() -> None:
    """Para e relanca a tarefa com as configuracoes atuais do banco -- chamado ao salvar Settings."""
    with _lock:
        _stop.set()
        if _thread is not None:
            _thread.join(timeout=5)
        _stop.clear()
    start()


def get_stats() -> dict:
    """Retorna o tamanho atual dos caches e o resultado do ultimo ciclo de aquecimento."""
    from app.routers import powerbi as embed_router
    enabled, interval = _load_db_settings()
    embed_count = len(embed_router._embed_cache)
    static_count = len(embed_router._report_static_cache)
    refresh_count = len(embed_router._refresh_info_cache)
    return {
        "warmup_enabled": enabled,
        "warmup_interval_seconds": interval,
        "warmup_running": _thread is not None and _thread.is_alive(),
        "last_run_at": _last_run_at.isoformat() if _last_run_at else None,
        "last_run_stats": _last_run_stats,
        "embed_tokens": embed_count,
        "report_static": static_count,
        "refresh_info": refresh_count,
        "total_entries": embed_count + static_count + refresh_count,
    }


def clear_all() -> None:
    """Limpa todos os caches de embed -- o proximo acesso forca uma chamada fresca ao Power BI."""
    from app.routers import powerbi as embed_router
    embed_router._embed_cache.clear()
    embed_router._report_static_cache.clear()
    embed_router._refresh_info_cache.clear()

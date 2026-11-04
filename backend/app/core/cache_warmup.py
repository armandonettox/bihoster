"""Aquecimento dos caches do Power BI em segundo plano.

Os caches de embed token, dados do relatorio e info de atualizacao vivem so na memoria do
processo: um deploy ou reinicio os esvazia, e a primeira pessoa a abrir uma colecao esperava
dezenas de chamadas ao Power BI. Esta tarefa enche os caches logo depois que o backend sobe e os
renova antes de vencerem, entao ninguem pega o cache vazio. Para desligar, defina a variavel de
ambiente CACHE_WARMUP_ENABLED com o valor falso; o intervalo entre ciclos vem da variavel
CACHE_WARMUP_INTERVAL_SECONDS (padrao em core/config.py).

So existe uma instancia desta tarefa porque o backend roda com um unico worker (ver Dockerfile)."""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)
# O uvicorn so mostra WARNING dos loggers da aplicacao; o resumo de cada ciclo e INFO, entao este
# logger tem o proprio handler (assim da pra conferir nos logs do container que o aquecimento roda).
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s:     %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

# Quantos relatorios sao aquecidos ao mesmo tempo
_WORKERS = 4
# Folga alem do intervalo: renova o que venceria antes do proximo ciclo
_RENEW_EXTRA = timedelta(seconds=60)
_MIN_INTERVAL_SECONDS = 30

_stop = threading.Event()
_thread: Optional[threading.Thread] = None


def warm_once(renew_before: timedelta) -> dict:
    """Um ciclo de aquecimento: relatorios (dados estaticos e token compartilhado) e info de
    atualizacao dos datasets. Falha de um item e registrada e nao interrompe os outros."""
    # Importados aqui: o roteador importa muita coisa e este modulo e carregado cedo por main.py
    from app.core.database import SessionLocal
    from app.models.powerbi_connection import PowerBIConnection
    from app.models.report import Report
    from app.routers import powerbi as embed_router

    db = SessionLocal()
    try:
        reports = db.query(Report).filter(Report.powerbi_connection_id.isnot(None)).all()
        connections = {c.id: embed_router._connection_snapshot(c) for c in db.query(PowerBIConnection).all()}
    finally:
        # Fecha a sessao ja aqui: as threads abaixo so leem atributos que ja foram carregados
        db.close()

    def warm_report(report) -> Optional[bool]:
        connection = connections.get(report.powerbi_connection_id)
        if connection is None:
            return None
        try:
            return embed_router.warm_report(connection, report.collection_id, report, renew_before)
        except Exception as exc:  # noqa: BLE001 -- um relatorio com problema nao pode parar o ciclo
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
    interval = max(_MIN_INTERVAL_SECONDS, settings.cache_warmup_interval_seconds)
    renew_before = timedelta(seconds=interval) + _RENEW_EXTRA
    while not _stop.is_set():
        try:
            stats = warm_once(renew_before)
            logger.info(
                "aquecimento de cache: %(relatorios)s relatorios, %(tokens_novos)s tokens novos, "
                "%(datasets)s datasets, %(erros)s erros",
                stats,
            )
        except Exception:  # noqa: BLE001 -- a tarefa nunca pode morrer por causa de um ciclo ruim
            logger.exception("aquecimento de cache falhou")
        _stop.wait(interval)


def start() -> None:
    """Inicia a tarefa em segundo plano (uma so), se estiver habilitada."""
    global _thread
    if not settings.cache_warmup_enabled or (_thread is not None and _thread.is_alive()):
        return
    _stop.clear()
    _thread = threading.Thread(target=_run, name="cache-warmup", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()

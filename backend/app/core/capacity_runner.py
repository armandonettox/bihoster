"""Rotina da agenda da capacidade (v1.54.0): a cada TICK_SECONDS confere se a capacidade de alguma conta deve pausar ou
retomar. Sem a chave geral ligada em Administracao nao faz nada; no modo simulado (o padrao) so registra. Tambem apaga as
contagens de abertura antigas. Mesmo padrao das outras rotinas."""

import logging
import threading
from typing import Optional

from app.core import azure_capacity, report_stats

logger = logging.getLogger(__name__)

TICK_SECONDS = 60

_stop = threading.Event()
_thread: Optional[threading.Thread] = None
_ticks = 0


def run_once() -> list[dict]:
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        return azure_capacity.tick(db)
    finally:
        db.close()


def _prune_stats() -> None:
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        report_stats.prune(db)
    finally:
        db.close()


def _loop() -> None:
    global _ticks
    while not _stop.is_set():
        try:
            run_once()
            _ticks += 1
            if _ticks % 1440 == 1:  # uma vez por dia (e ao subir)
                _prune_stats()
        except Exception:  # noqa: BLE001 -- a rotina nao pode morrer por um erro de uma rodada
            logger.exception("rotina da capacidade falhou")
        _stop.wait(TICK_SECONDS)


def start() -> None:
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="capacity-runner", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()

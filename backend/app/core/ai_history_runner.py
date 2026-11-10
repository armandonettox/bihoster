"""Apaga de hora em hora as conversas do chat de IA que passaram do prazo de retencao.

Roda numa thread, como os outros processos em segundo plano do projeto (alertas, assinaturas)."""

import logging
import threading
from typing import Optional

from app.core import chat_history
from app.core.database import SessionLocal

logger = logging.getLogger(__name__)

TICK_SECONDS = 3600

_stop = threading.Event()
_thread: Optional[threading.Thread] = None


def run_once() -> int:
    """Uma rodada de limpeza. Devolve quantas conversas foram apagadas."""
    db = SessionLocal()
    try:
        removed = chat_history.purge_expired(db)
        if removed:
            logger.info("historico do chat de IA: %d conversas vencidas apagadas", removed)
        return removed
    finally:
        db.close()


def _loop() -> None:
    while not _stop.is_set():
        try:
            run_once()
        except Exception:  # noqa: BLE001
            logger.exception("falha na limpeza do historico do chat de IA")
        _stop.wait(TICK_SECONDS)


def start() -> None:
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="ai-history-cleanup", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()

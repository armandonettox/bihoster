"""Rotina da sincronizacao agendada do catalogo.

Acorda a cada TICK_SECONDS e sincroniza as contas cujo intervalo (powerbi_connections.sync_interval_hours)
ja passou desde a ultima rodada. Conta sem intervalo (o padrao) nunca e sincronizada sozinha: so pelo botao.
Segue o mesmo padrao das outras rotinas (subscription_runner, alert_runner, cache_warmup)."""

import logging
import threading
from typing import Optional

from app.core import catalog_sync

logger = logging.getLogger(__name__)

TICK_SECONDS = 300

_stop = threading.Event()
_thread: Optional[threading.Thread] = None


def _loop() -> None:
    while not _stop.is_set():
        try:
            catalog_sync.run_scheduled_once()
        except Exception:  # noqa: BLE001 -- a rotina nao pode morrer por um erro de uma rodada
            logger.exception("sincronizacao agendada do catalogo falhou")
        _stop.wait(TICK_SECONDS)


def start() -> None:
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="catalog-sync-runner", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()

"""Imagem da pagina aberta de um relatorio, para a IA ver os graficos.

A exportacao em PNG do Power BI leva de segundos a minutos, entao ela nunca roda dentro da pergunta: o
navegador pede para "aquecer" a pagina quando o chat abre no relatorio, a exportacao roda em segundo plano
(com as mesmas vagas das assinaturas por e-mail) e a imagem fica em memoria por pouco tempo. O motor do chat
so usa a imagem que ja estiver pronta. Nada e gravado em disco, e so se exporta relatorio que o admin liberou
(`allow_images`) e que passou na checagem de RLS."""

import io
import logging
import threading
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core import powerbi, report_delivery

logger = logging.getLogger(__name__)

IMAGE_TTL = timedelta(minutes=15)
MAX_ENTRIES = 20
MAX_IMAGE_BYTES = 4 * 1024 * 1024  # sem redimensionar (nao ha biblioteca de imagem): acima disso, nao vai

_lock = threading.Lock()
_cache: dict[tuple[int, str], tuple[datetime, bytes]] = {}
_in_flight: set[tuple[int, str]] = set()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def clear() -> None:
    with _lock:
        _cache.clear()
        _in_flight.clear()


def get(report_id: int, page_name: str) -> Optional[bytes]:
    """A imagem pronta da pagina, ou None (nao existe, venceu ou ainda esta sendo gerada)."""
    with _lock:
        entry = _cache.get((report_id, page_name))
        if entry is None:
            return None
        if entry[0] <= _now():
            del _cache[(report_id, page_name)]
            return None
        return entry[1]


def _store(key: tuple[int, str], data: bytes) -> None:
    with _lock:
        now = _now()
        for old in [k for k, (expires, _) in _cache.items() if expires <= now]:
            del _cache[old]
        while len(_cache) >= MAX_ENTRIES:
            oldest = min(_cache, key=lambda k: _cache[k][0])
            del _cache[oldest]
        _cache[key] = (now + IMAGE_TTL, data)


def _first_png(data: bytes) -> bytes:
    """O Power BI devolve um zip quando o pedido tem varias paginas; aqui e uma so, mas aceita os dois."""
    if data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith(".png")]
            if not names:
                raise powerbi.PowerBIError("A exportacao nao trouxe nenhuma imagem.")
            return archive.read(names[0])
    return data


def _export(connection, workspace_id: str, pbi_report_id: str, page_name: str) -> bytes:
    with report_delivery._export_slots:
        data = powerbi.export_report(connection, workspace_id, pbi_report_id, "PNG", [page_name])
    return _first_png(data)


def _run(key: tuple[int, str], connection, workspace_id: str, pbi_report_id: str, page_name: str) -> None:
    """Exporta e guarda. Nunca levanta: falha so deixa a imagem sem existir e a pergunta segue por texto."""
    try:
        data = _export(connection, workspace_id, pbi_report_id, page_name)
        if len(data) > MAX_IMAGE_BYTES:
            logger.warning("imagem da pagina passou de %d bytes e foi descartada", MAX_IMAGE_BYTES)
        else:
            _store(key, data)
    except Exception:  # noqa: BLE001 -- a thread nunca pode morrer sem limpar a marca de "em andamento"
        logger.warning("nao foi possivel gerar a imagem da pagina do relatorio %s", key[0], exc_info=True)
    finally:
        with _lock:
            _in_flight.discard(key)


def warm(connection, report, page_name: str, background: bool = True) -> str:
    """Garante que a imagem da pagina exista ou esteja a caminho. Devolve "ready" (ja esta pronta) ou
    "warming" (foi pedida ou ja estava sendo gerada). Com `background=False` espera terminar (para testes)."""
    key = (report.id, page_name)
    if get(report.id, page_name) is not None:
        return "ready"
    with _lock:
        if key in _in_flight:
            return "warming"
        _in_flight.add(key)
    args = (key, connection, report.pbi_workspace_id, report.pbi_report_id, page_name)
    if background:
        threading.Thread(target=_run, args=args, name="chat-page-image", daemon=True).start()
        return "warming"
    _run(*args)
    return "ready" if get(report.id, page_name) is not None else "warming"

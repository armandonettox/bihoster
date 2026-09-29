from datetime import datetime, timezone
from typing import Annotated

from pydantic import PlainSerializer


def _as_utc_iso(value: datetime) -> str:
    """O SQLite guarda e devolve datetime sem tzinfo (CURRENT_TIMESTAMP e sempre UTC). Serializar
    assim mesmo faz o navegador ler "2026-09-29T13:00:00" como horario LOCAL, deslocando a data
    pela diferenca de fuso. Marca como UTC e sai com "Z" pro cliente converter certo."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# Datetime que sempre sai no JSON como UTC com "Z" (ex: 2026-09-29T13:00:00Z)
UtcDatetime = Annotated[datetime, PlainSerializer(_as_utc_iso, return_type=str, when_used="json")]

from typing import Optional

from pydantic import BaseModel


class AIReportCheckOut(BaseModel):
    """Diagnostico de um relatorio para o chat. So contagens e o motivo do bloqueio: nunca linhas
    de dado nem nomes de tabelas ou colunas."""

    report_id: int
    report_name: str
    eligible: bool
    reason: Optional[str]
    tables: Optional[int]
    columns: Optional[int]
    measures: Optional[int]
    latency_ms: int

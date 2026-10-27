from typing import Optional

from pydantic import BaseModel

from app.schemas.types import UtcDatetime


class EmbedConfig(BaseModel):
    report_id: str
    embed_url: str
    access_token: str
    # Primeira aba escolhida (legado); a lista completa vem em page_names. Vazia = relatorio inteiro.
    page_name: str | None = None
    page_names: list[str] = []
    # Quando o embed token expira (UTC, com Z): o frontend usa pra renovar o token antes de o
    # relatorio ficar em branco (ex: modo TV, ou aba deixada aberta por mais de 1h).
    expires_at: Optional[UtcDatetime] = None
    show_filter_pane: bool = False
    show_page_nav: bool = False


class RefreshHistoryItem(BaseModel):
    status: str
    startTime: str | None = None
    endTime: str | None = None

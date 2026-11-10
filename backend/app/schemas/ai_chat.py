import re
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas.types import UtcDatetime


_PAGE_NAME = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


def _short(value, limit: int) -> str:
    return " ".join(str(value).split())[:limit]


class PageVisualIn(BaseModel):
    """Um grafico da pagina aberta. Os textos vem do navegador: o que passa do limite e cortado, nao recusado."""

    title: str = ""
    type: str = ""
    fields: list[str] = Field(default_factory=list)

    @field_validator("title", mode="before")
    @classmethod
    def cut_title(cls, value):
        return _short(value or "", 200)

    @field_validator("type", mode="before")
    @classmethod
    def cut_type(cls, value):
        return _short(value or "", 60)

    @field_validator("fields", mode="before")
    @classmethod
    def cut_fields(cls, value):
        return [_short(item, 200) for item in value[:20]] if isinstance(value, list) else []


class OpenPageIn(BaseModel):
    """O relatorio e a pagina que a pessoa tem aberta e os campos de cada grafico (lidos pelo SDK do Power BI)."""

    report_id: int
    page_name: Optional[str] = None
    page_title: Optional[str] = None
    visuals: list[PageVisualIn] = Field(default_factory=list)

    @field_validator("page_name", mode="before")
    @classmethod
    def valid_page_name(cls, value):
        # Nome tecnico de pagina fora do formato do Power BI e ignorado (a imagem nao e pedida)
        return value if isinstance(value, str) and _PAGE_NAME.match(value) else None

    @field_validator("page_title", mode="before")
    @classmethod
    def cut_page_title(cls, value):
        return _short(value, 200) if value else None

    @field_validator("visuals", mode="before")
    @classmethod
    def cut_visuals(cls, value):
        return value[:40] if isinstance(value, list) else []


class ChatIn(BaseModel):
    message: str = Field(max_length=4000)
    # Sem conversation_id, comeca uma conversa nova; com ele, continua uma conversa da propria pessoa
    conversation_id: Optional[int] = None
    # Preenchido quando o chat esta aberto dentro de um relatorio: ajuda a IA a achar as colunas dos graficos
    open_page: Optional[OpenPageIn] = None

    @field_validator("message")
    @classmethod
    def not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A mensagem nao pode ser vazia")
        return value


class ChatReportOut(BaseModel):
    id: int
    name: str


class ChatTableOut(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    total_rows: int
    truncated: bool


class ChatUsageOut(BaseModel):
    provider: str
    model: str
    llm_calls: int
    input_tokens: int
    output_tokens: int
    cost_usd: Optional[float] = None  # so o OpenRouter tem preco; nos outros fica nulo


class ChatOut(BaseModel):
    conversation_id: int
    conversation_title: str
    reply: str
    report: Optional[ChatReportOut]
    dax: Optional[str]
    table: Optional[ChatTableOut]  # so nesta resposta: o historico nao guarda as linhas
    usage: ChatUsageOut
    used_image: bool = False  # a imagem da pagina foi enviada ao provedor de IA nesta pergunta


class ConversationOut(BaseModel):
    id: int
    title: str
    created_at: UtcDatetime
    updated_at: UtcDatetime

    class Config:
        from_attributes = True


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    report: Optional[ChatReportOut]
    dax: Optional[str]
    created_at: UtcDatetime


class ConversationDetailOut(ConversationOut):
    messages: list[MessageOut]

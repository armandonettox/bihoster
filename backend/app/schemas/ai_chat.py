from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas.types import UtcDatetime


class ChatIn(BaseModel):
    message: str = Field(max_length=4000)
    # Sem conversation_id, comeca uma conversa nova; com ele, continua uma conversa da propria pessoa
    conversation_id: Optional[int] = None

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

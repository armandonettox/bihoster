from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class ChatMessageIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)

    @field_validator("content")
    @classmethod
    def not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A mensagem nao pode ser vazia")
        return value


class ChatIn(BaseModel):
    # A conversa inteira vem do cliente: o servidor ainda nao guarda historico. A ultima mensagem
    # e a pergunta nova.
    messages: list[ChatMessageIn] = Field(min_length=1, max_length=20)
    # Relatorio que a conversa vinha usando; a IA mantem, a menos que a pergunta mude de assunto
    report_id: Optional[int] = None

    @model_validator(mode="after")
    def last_is_user(self) -> "ChatIn":
        if self.messages[-1].role != "user":
            raise ValueError("A ultima mensagem precisa ser do usuario")
        return self


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


class ChatOut(BaseModel):
    reply: str
    report: Optional[ChatReportOut]
    dax: Optional[str]
    table: Optional[ChatTableOut]
    usage: ChatUsageOut

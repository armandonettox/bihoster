from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.core.ai_report_settings import MAX_BLOCKED_COLUMNS, MAX_NAME_CHARS, MAX_NOTES_CHARS


class BlockedColumn(BaseModel):
    table: str = Field(min_length=1, max_length=MAX_NAME_CHARS)
    column: str = Field(min_length=1, max_length=MAX_NAME_CHARS)

    @field_validator("table", "column")
    @classmethod
    def not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("O nome nao pode ser vazio")
        return value


class AIReportSettingsOut(BaseModel):
    report_id: int
    report_name: str
    notes: str
    blocked_columns: list[BlockedColumn]
    allow_images: bool


class AIReportSettingsUpdate(BaseModel):
    notes: str = Field(default="", max_length=MAX_NOTES_CHARS)
    blocked_columns: list[BlockedColumn] = Field(default_factory=list, max_length=MAX_BLOCKED_COLUMNS)
    allow_images: bool = False


class PageImageIn(BaseModel):
    # Nome tecnico da pagina no Power BI (letras, numeros, hifen e sublinhado)
    page_name: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")


class PageImageOut(BaseModel):
    # ready: ja pode ser usada; warming: sendo gerada; disabled: o admin nao liberou imagens para o relatorio
    state: Literal["ready", "warming", "disabled"]


class AISchemaColumnOut(BaseModel):
    name: str
    data_type: Optional[str]
    distinct: Optional[int]
    blocked: bool


class AISchemaTableOut(BaseModel):
    name: str
    columns: list[AISchemaColumnOut]
    measures: list[str]
    in_prompt: bool  # False quando a tabela nao coube no esquema enviado a IA


class AIReportSchemaOut(BaseModel):
    """O que a IA enxerga de um relatorio: so nomes e contagens, nunca linhas de dados."""

    report_id: int
    report_name: str
    eligible: bool
    reason: Optional[str]
    tables: Optional[list[AISchemaTableOut]]
    prompt_chars: int
    prompt_max_chars: int
    omitted_tables: list[str]
    omitted_columns: int
    hidden_columns: int

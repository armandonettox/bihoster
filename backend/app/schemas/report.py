from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

DisplayType = Literal["relatorio", "painel", "apresentacao", "tv"]

# Nomes tecnicos das abas do Power BI escolhidas pra exibir
PageNames = Annotated[list[Annotated[str, Field(max_length=100)]], Field(max_length=50)]


def clean_page_names(names: Optional[list[str]]) -> list[str]:
    """Tira espacos, descarta itens em branco e repetidos, mantendo a ordem."""
    cleaned: list[str] = []
    for name in names or []:
        name = name.strip()
        if name and name not in cleaned:
            cleaned.append(name)
    return cleaned


def resolve_page_names(data: "ReportCreate | ReportUpdate") -> Optional[list[str]]:
    """Abas pedidas no payload, ou None se o payload nao mexe nelas."""
    if "pbi_page_names" in data.model_fields_set:
        return clean_page_names(data.pbi_page_names)
    if "pbi_page_name" in data.model_fields_set:
        return clean_page_names([data.pbi_page_name] if data.pbi_page_name else [])
    return None

# Campos que sao NOT NULL no banco (Report) -- um cliente mandando explicitamente
# {"campo": null} deve dar 422, nao quebrar com IntegrityError no commit (500).
_REPORT_NOT_NULLABLE_FIELDS = ("name", "pbi_workspace_id", "pbi_report_id", "display_type")
_REPORT_TEXT_FIELDS = ("name", "pbi_workspace_id", "pbi_report_id")


def _strip_and_require_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("O campo nao pode ficar em branco")
    return value


class ReportCreate(BaseModel):
    name: str = Field(max_length=200)
    powerbi_connection_id: int
    pbi_workspace_id: str = Field(max_length=100)
    pbi_report_id: str = Field(max_length=100)
    pbi_dataset_id: Optional[str] = Field(default=None, max_length=100)
    # Legado (uma aba so): continua aceito, vira uma lista de 1 item. Se mandar as duas, vale a lista.
    pbi_page_name: Optional[str] = Field(default=None, max_length=100)
    pbi_page_names: Optional[PageNames] = None
    display_type: DisplayType = "relatorio"

    @field_validator(*_REPORT_TEXT_FIELDS)
    @classmethod
    def text_not_blank(cls, value: str) -> str:
        return _strip_and_require_text(value)


class ReportUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    powerbi_connection_id: Optional[int] = None
    pbi_workspace_id: Optional[str] = Field(default=None, max_length=100)
    pbi_report_id: Optional[str] = Field(default=None, max_length=100)
    pbi_dataset_id: Optional[str] = Field(default=None, max_length=100)
    # Nullable de proposito: null explicito (ou lista vazia) significa "relatorio inteiro, sem aba
    # especifica". pbi_page_name e o formato legado de uma aba so; se mandar as duas, vale a lista.
    pbi_page_name: Optional[str] = Field(default=None, max_length=100)
    pbi_page_names: Optional[PageNames] = None
    display_type: Optional[DisplayType] = None

    @field_validator(*_REPORT_TEXT_FIELDS)
    @classmethod
    def text_not_blank(cls, value: Optional[str]) -> Optional[str]:
        return _strip_and_require_text(value)

    @model_validator(mode="after")
    def reject_explicit_null_on_required_fields(self) -> "ReportUpdate":
        for field_name in _REPORT_NOT_NULLABLE_FIELDS:
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"O campo '{field_name}' nao pode ser nulo")
        return self


class ReportMove(BaseModel):
    direction: Literal["up", "down"]


class ReportOut(BaseModel):
    id: int
    collection_id: int
    name: str
    powerbi_connection_id: Optional[int]
    pbi_workspace_id: str
    pbi_report_id: str
    pbi_dataset_id: Optional[str]
    # Primeira aba escolhida (legado, pra clientes antigos); a lista completa vem em pbi_page_names
    pbi_page_name: Optional[str]
    pbi_page_names: list[str] = []
    display_type: DisplayType

    class Config:
        from_attributes = True

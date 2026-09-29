from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

DisplayType = Literal["relatorio", "painel", "apresentacao", "tv"]

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
    pbi_page_name: Optional[str] = Field(default=None, max_length=100)
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
    # Nullable de proposito: null explicito significa "relatorio inteiro, sem aba especifica"
    pbi_page_name: Optional[str] = Field(default=None, max_length=100)
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
    pbi_page_name: Optional[str]
    display_type: DisplayType

    class Config:
        from_attributes = True

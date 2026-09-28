from typing import Literal, Optional

from pydantic import BaseModel, Field

DisplayType = Literal["relatorio", "painel", "apresentacao", "tv"]


class ReportCreate(BaseModel):
    name: str = Field(max_length=200)
    powerbi_connection_id: int
    pbi_workspace_id: str = Field(max_length=100)
    pbi_report_id: str = Field(max_length=100)
    pbi_dataset_id: Optional[str] = Field(default=None, max_length=100)
    display_type: DisplayType = "relatorio"


class ReportUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    powerbi_connection_id: Optional[int] = None
    pbi_workspace_id: Optional[str] = Field(default=None, max_length=100)
    pbi_report_id: Optional[str] = Field(default=None, max_length=100)
    pbi_dataset_id: Optional[str] = Field(default=None, max_length=100)
    display_type: Optional[DisplayType] = None


class ReportOut(BaseModel):
    id: int
    collection_id: int
    name: str
    powerbi_connection_id: Optional[int]
    pbi_workspace_id: str
    pbi_report_id: str
    pbi_dataset_id: Optional[str]
    display_type: DisplayType

    class Config:
        from_attributes = True

from typing import Optional

from pydantic import BaseModel, Field

from app.models.alert import ALERT_CONDITIONS

_VALID_CONDITIONS = set(ALERT_CONDITIONS)


class AlertCreate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    measure_name: str = Field(min_length=1, max_length=200)
    table_name: Optional[str] = Field(default=None, max_length=200)
    condition: str
    threshold: float
    recipients: list[str] = Field(min_length=1)
    subject: Optional[str] = Field(default=None, max_length=150)
    message: Optional[str] = Field(default=None, max_length=1000)
    check_interval_minutes: int = Field(default=60, ge=5, le=1440)
    cooldown_hours: int = Field(default=24, ge=1, le=720)
    enabled: bool = True

    def model_post_init(self, __context) -> None:
        if self.condition not in _VALID_CONDITIONS:
            raise ValueError(f"Condicao invalida: {self.condition!r}. Use um de: {', '.join(sorted(_VALID_CONDITIONS))}")


class AlertUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    measure_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    table_name: Optional[str] = Field(default=None, max_length=200)
    condition: Optional[str] = None
    threshold: Optional[float] = None
    recipients: Optional[list[str]] = None
    subject: Optional[str] = Field(default=None, max_length=150)
    message: Optional[str] = Field(default=None, max_length=1000)
    check_interval_minutes: Optional[int] = Field(default=None, ge=5, le=1440)
    cooldown_hours: Optional[int] = Field(default=None, ge=1, le=720)
    enabled: Optional[bool] = None

    def model_post_init(self, __context) -> None:
        if self.condition is not None and self.condition not in _VALID_CONDITIONS:
            raise ValueError(f"Condicao invalida: {self.condition!r}.")


class AlertOut(BaseModel):
    id: int
    report_id: int
    report_name: str
    collection_id: int
    collection_name: Optional[str] = None
    created_by_name: Optional[str] = None
    name: Optional[str]
    measure_name: str
    table_name: Optional[str]
    condition: str
    threshold: float
    recipients: list[str]
    subject: Optional[str]
    message: Optional[str]
    check_interval_minutes: int
    cooldown_hours: int
    enabled: bool
    last_checked_at: Optional[str] = None
    last_triggered_at: Optional[str] = None
    last_value: Optional[float] = None
    last_status: Optional[str] = None
    last_message: Optional[str] = None
    created_at: Optional[str] = None

    model_config = {"from_attributes": True}


class MeasureOut(BaseModel):
    measure_name: str
    table_name: str

import re
from typing import Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator

LoginLayout = Literal["centered", "split"]

HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")

# Campos que sao NOT NULL no banco (AppSettings) -- um cliente mandando explicitamente
# {"campo": null} deve dar 422, nao quebrar com IntegrityError no commit.
_SETTINGS_NOT_NULLABLE_FIELDS = (
    "company_name",
    "primary_color",
    "secondary_color",
    "login_layout",
    "timezone",
    "force_https",
    "allow_registration",
    "google_oauth_enabled",
)


class SettingsUpdate(BaseModel):
    company_name: Optional[str] = Field(default=None, max_length=200)
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    login_layout: Optional[LoginLayout] = None
    timezone: Optional[str] = None
    site_url: Optional[str] = Field(default=None, max_length=500)
    support_email: Optional[str] = Field(default=None, max_length=200)
    force_https: Optional[bool] = None
    default_workspace_id: Optional[int] = None
    allow_registration: Optional[bool] = None
    google_oauth_enabled: Optional[bool] = None
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None
    google_allowed_domains: Optional[str] = None

    @field_validator("google_allowed_domains")
    @classmethod
    def domains_normalize(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        domains = [d.strip().lower().lstrip("@") for d in value.split(",") if d.strip()]
        return ",".join(domains)

    @field_validator("timezone")
    @classmethod
    def timezone_valid(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Fuso horario invalido")
        return value

    @field_validator("primary_color", "secondary_color")
    @classmethod
    def color_valid(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if not HEX_COLOR_PATTERN.match(value):
            raise ValueError("Cor invalida -- use o formato hexadecimal #RRGGBB")
        return value.upper()

    @model_validator(mode="after")
    def reject_explicit_null_on_required_fields(self) -> "SettingsUpdate":
        for field_name in _SETTINGS_NOT_NULLABLE_FIELDS:
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"O campo '{field_name}' nao pode ser nulo")
        return self


class SettingsOut(BaseModel):
    company_name: str
    primary_color: str
    secondary_color: str
    logo_url: Optional[str]
    favicon_url: Optional[str]
    login_image_url: Optional[str]
    login_layout: LoginLayout
    timezone: str
    site_url: Optional[str]
    support_email: Optional[str]
    force_https: bool
    default_workspace_id: Optional[int]
    allow_registration: bool
    google_oauth_enabled: bool
    google_client_id: Optional[str]
    google_client_secret_configured: bool = False
    google_allowed_domains: Optional[str]

    class Config:
        from_attributes = True

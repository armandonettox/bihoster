import re
from typing import Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator

LoginLayout = Literal["centered", "split"]

HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")

# Textos das telas de erro (404 e erro inesperado). Os mesmos limites valem nos campos da tela de Marca.
ERROR_TITLE_MAX_CHARS = 80
ERROR_MESSAGE_MAX_CHARS = 300
ERROR_BUTTON_MAX_CHARS = 40

# Campos que sao NOT NULL no banco (AppSettings) -- um cliente mandando explicitamente
# {"campo": null} deve dar 422, nao quebrar com IntegrityError no commit.
_SETTINGS_NOT_NULLABLE_FIELDS = (
    "company_name",
    "primary_color",
    "secondary_color",
    "login_layout",
    "timezone",
    "force_https",
    "single_collection_redirect",
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
    single_collection_redirect: Optional[bool] = None
    default_workspace_id: Optional[int] = None
    not_found_title: Optional[str] = Field(default=None, max_length=ERROR_TITLE_MAX_CHARS)
    not_found_message: Optional[str] = Field(default=None, max_length=ERROR_MESSAGE_MAX_CHARS)
    not_found_button: Optional[str] = Field(default=None, max_length=ERROR_BUTTON_MAX_CHARS)
    error_title: Optional[str] = Field(default=None, max_length=ERROR_TITLE_MAX_CHARS)
    error_message: Optional[str] = Field(default=None, max_length=ERROR_MESSAGE_MAX_CHARS)
    error_button: Optional[str] = Field(default=None, max_length=ERROR_BUTTON_MAX_CHARS)
    outside_hours_title: Optional[str] = Field(default=None, max_length=ERROR_TITLE_MAX_CHARS)
    outside_hours_message: Optional[str] = Field(default=None, max_length=ERROR_MESSAGE_MAX_CHARS)
    outside_hours_button: Optional[str] = Field(default=None, max_length=ERROR_BUTTON_MAX_CHARS)
    no_access_title: Optional[str] = Field(default=None, max_length=ERROR_TITLE_MAX_CHARS)
    no_access_message: Optional[str] = Field(default=None, max_length=ERROR_MESSAGE_MAX_CHARS)
    no_access_button: Optional[str] = Field(default=None, max_length=ERROR_BUTTON_MAX_CHARS)
    allow_registration: Optional[bool] = None
    google_oauth_enabled: Optional[bool] = None
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None
    google_allowed_domains: Optional[str] = None
    cache_warmup_enabled: Optional[bool] = None
    cache_warmup_interval_seconds: Optional[int] = Field(default=None, ge=30, le=3600)
    embed_preload_enabled: Optional[bool] = None
    cache_warmup_only_recent: Optional[bool] = None
    cache_warmup_recent_hours: Optional[int] = Field(default=None, ge=1, le=720)
    capacity_control_enabled: Optional[bool] = None

    @field_validator(
        "not_found_title", "not_found_message", "not_found_button", "error_title", "error_message", "error_button",
        "outside_hours_title", "outside_hours_message", "outside_hours_button",
        "no_access_title", "no_access_message", "no_access_button",
    )
    @classmethod
    def error_text_normalize(cls, value: Optional[str]) -> Optional[str]:
        """Sem espaços nas pontas; texto vazio vira nulo, que significa "usar o texto padrão"."""
        if value is None:
            return None
        return value.strip() or None

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
    single_collection_redirect: bool = False
    default_workspace_id: Optional[int]
    not_found_title: Optional[str] = None
    not_found_message: Optional[str] = None
    not_found_button: Optional[str] = None
    error_title: Optional[str] = None
    error_message: Optional[str] = None
    error_button: Optional[str] = None
    outside_hours_title: Optional[str] = None
    outside_hours_message: Optional[str] = None
    outside_hours_button: Optional[str] = None
    no_access_title: Optional[str] = None
    no_access_message: Optional[str] = None
    no_access_button: Optional[str] = None
    allow_registration: bool
    google_oauth_enabled: bool
    google_client_id: Optional[str]
    google_client_secret_configured: bool = False
    google_allowed_domains: Optional[str]
    cache_warmup_enabled: bool = True
    cache_warmup_interval_seconds: int = 240
    embed_preload_enabled: bool = True
    cache_warmup_only_recent: bool = False
    cache_warmup_recent_hours: int = 72
    capacity_control_enabled: bool = False

    class Config:
        from_attributes = True

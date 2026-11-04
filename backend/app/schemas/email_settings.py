from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

SmtpSecurity = Literal["starttls", "ssl", "none"]


class EmailSettingsUpdate(BaseModel):
    smtp_host: Optional[str] = Field(default=None, max_length=255)
    smtp_port: Optional[int] = Field(default=None, ge=1, le=65535)
    smtp_security: Optional[SmtpSecurity] = None
    smtp_username: Optional[str] = Field(default=None, max_length=255)
    # None = manter a senha atual; texto vazio = apagar; qualquer outro valor = trocar
    smtp_password: Optional[str] = Field(default=None, max_length=500)
    smtp_from_email: Optional[EmailStr] = None
    smtp_from_name: Optional[str] = Field(default=None, max_length=200)
    email_allowed_domains: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("smtp_host", "smtp_username", "smtp_from_name")
    @classmethod
    def strip_text(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() if value is not None else value

    @field_validator("email_allowed_domains")
    @classmethod
    def normalize_domains(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        domains = [d.strip().lower().lstrip("@") for d in value.split(",") if d.strip()]
        return ",".join(dict.fromkeys(domains))  # sem repetidos, mesma ordem

    @model_validator(mode="after")
    def credentials_need_encryption(self) -> "EmailSettingsUpdate":
        # Usuario e senha em conexao sem criptografia viajam em texto claro pela rede
        if self.smtp_security == "none" and (self.smtp_username or self.smtp_password):
            raise ValueError("Para usar usuario e senha escolha STARTTLS ou SSL: sem seguranca eles viajam em texto claro")
        return self


class EmailSettingsOut(BaseModel):
    """Nunca inclui a senha: so um booleano dizendo se ela ja foi configurada."""

    smtp_host: Optional[str]
    smtp_port: Optional[int]
    smtp_security: Optional[str]
    smtp_username: Optional[str]
    smtp_password_configured: bool
    smtp_from_email: Optional[str]
    smtp_from_name: Optional[str]
    email_allowed_domains: Optional[str]
    configured: bool


class EmailStatus(BaseModel):
    configured: bool
    # Dominios onde se pode mandar e-mail (vazio = qualquer um). A tela de assinaturas precisa saber:
    # editor da colecao so assina quando ha lista.
    allowed_domains: list[str] = []


class EmailTestRequest(BaseModel):
    to: EmailStr

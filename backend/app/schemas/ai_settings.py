import re
from typing import Optional

from pydantic import BaseModel, Field, field_validator

# So caracteres ASCII visiveis, sem espaco: chave colada com quebra de linha ou acento quebraria
# o cabecalho da chamada, e o erro apareceria so na hora de usar
_API_KEY_PATTERN = re.compile(r"^[\x21-\x7e]+$")


class AIProviderUpdate(BaseModel):
    # None = manter a chave atual; texto vazio = apagar; qualquer outro valor = trocar
    api_key: Optional[str] = Field(default=None, max_length=500)
    model: Optional[str] = Field(default=None, max_length=200)
    enabled: Optional[bool] = None
    # True escolhe este provedor para o chat (e tira dos outros); False tira dele
    chat_default: Optional[bool] = None

    @field_validator("api_key")
    @classmethod
    def validate_api_key(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip()
        if value and not _API_KEY_PATTERN.match(value):
            raise ValueError("A chave de API so pode ter letras, numeros e simbolos, sem espacos nem quebras de linha")
        return value

    @field_validator("model")
    @classmethod
    def strip_model(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() if value is not None else value


class AIProviderOut(BaseModel):
    """Nunca inclui a chave: so um booleano dizendo se ela ja foi cadastrada."""

    provider: str
    label: str
    example_model: str
    api_key_configured: bool
    model: Optional[str]
    enabled: bool
    chat_default: bool


class AIProviderTestOut(BaseModel):
    ok: bool
    model: str
    latency_ms: int

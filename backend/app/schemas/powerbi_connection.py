from typing import Optional

from pydantic import BaseModel, Field


class PowerBIConnectionCreate(BaseModel):
    name: str = Field(max_length=200)
    tenant_id: str = Field(max_length=100)
    client_id: str = Field(max_length=100)
    client_secret: str = Field(max_length=500)


class PowerBIConnectionUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    tenant_id: Optional[str] = Field(default=None, max_length=100)
    client_id: Optional[str] = Field(default=None, max_length=100)
    client_secret: Optional[str] = Field(default=None, max_length=500)


class PowerBIConnectionOut(BaseModel):
    """O secret nunca e devolvido -- so um booleano dizendo se ja foi configurado."""

    id: int
    name: str
    tenant_id: str
    client_id: str
    client_secret_configured: bool

    class Config:
        from_attributes = True

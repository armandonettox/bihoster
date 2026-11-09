from pydantic import BaseModel, field_validator

from app.core.ai_access import AI_PERMISSIONS


class GroupPermissionsOut(BaseModel):
    permissions: list[str]
    # False no grupo Administradores: ele tem todas as permissoes sempre
    editable: bool


class GroupPermissionsUpdate(BaseModel):
    permissions: list[str]

    @field_validator("permissions")
    @classmethod
    def only_known_keys(cls, value: list[str]) -> list[str]:
        unknown = [key for key in value if key not in AI_PERMISSIONS]
        if unknown:
            raise ValueError(f"Chave de permissao invalida: {', '.join(unknown)}")
        return sorted(set(value))  # sem repetidos


class AIAccessOut(BaseModel):
    can_manage: bool
    can_use: bool

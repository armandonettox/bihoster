from pydantic import BaseModel, field_validator

from app.core.permission_keys import MANAGED_PERMISSIONS, with_implied


class GroupPermissionsOut(BaseModel):
    permissions: list[str]
    # False no grupo Administradores: ele tem todas as permissoes sempre
    editable: bool


class GroupPermissionsUpdate(BaseModel):
    permissions: list[str]

    @field_validator("permissions")
    @classmethod
    def only_known_keys(cls, value: list[str]) -> list[str]:
        unknown = [key for key in value if key not in MANAGED_PERMISSIONS]
        if unknown:
            raise ValueError(f"Chave de permissao invalida: {', '.join(unknown)}")
        # Sem repetidos; quem pode criar, editar ou excluir analiticos tambem pode ver
        return with_implied(value)


class AIAccessOut(BaseModel):
    can_manage: bool
    can_use: bool


class AnalyticsAccessOut(BaseModel):
    can_view: bool
    can_create: bool
    can_edit: bool
    can_delete: bool

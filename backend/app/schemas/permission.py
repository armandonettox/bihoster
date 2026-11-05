from typing import Optional
from pydantic import BaseModel
from app.schemas.types import UtcDatetime


class PermissionLevelOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    is_system: bool
    grants: list[str]
    created_at: UtcDatetime

    model_config = {"from_attributes": True}


class PermissionLevelCreate(BaseModel):
    name: str
    description: Optional[str] = None
    grants: list[str] = []


class PermissionLevelUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    grants: Optional[list[str]] = None


class AssignLevelIn(BaseModel):
    permission_level_id: Optional[int] = None


class MyPermissionsOut(BaseModel):
    permission_level_id: Optional[int]
    permission_level_name: Optional[str]
    permissions: list[str]

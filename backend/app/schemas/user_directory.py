from typing import Optional

from pydantic import BaseModel, field_validator

from app.schemas.types import UtcDatetime


class UserGroupOut(BaseModel):
    id: int
    name: str
    is_default: bool
    is_admin_group: bool


class UserDirectoryOut(BaseModel):
    id: int
    name: str
    email: str
    groups: list[UserGroupOut]
    last_login: Optional[UtcDatetime]
    is_blocked: bool = False

    @field_validator("is_blocked", mode="before")
    @classmethod
    def blocked_none_is_false(cls, value):
        """Coluna nova e nula nas pessoas antigas: nulo vale como nao bloqueada."""
        return bool(value)


class PendingInviteOut(BaseModel):
    id: int
    email: str
    group_id: int
    group_name: str
    created_at: UtcDatetime

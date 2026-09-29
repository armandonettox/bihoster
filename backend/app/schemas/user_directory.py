from typing import Optional

from pydantic import BaseModel

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


class PendingInviteOut(BaseModel):
    id: int
    email: str
    group_id: int
    group_name: str
    created_at: UtcDatetime

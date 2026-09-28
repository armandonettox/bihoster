from datetime import datetime
from typing import Optional

from pydantic import BaseModel


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
    last_login: Optional[datetime]


class PendingInviteOut(BaseModel):
    id: int
    email: str
    group_id: int
    group_name: str
    created_at: datetime

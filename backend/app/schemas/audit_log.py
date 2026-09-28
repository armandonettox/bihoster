from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: int
    user_id: Optional[int]
    user_name: Optional[str] = None
    workspace_id: Optional[int]
    workspace_name: Optional[str] = None
    action: str
    entity: str
    entity_id: Optional[str]
    details: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True

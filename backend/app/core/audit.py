from typing import Optional

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog


def log_action(
    db: Session,
    action: str,
    entity: str,
    user_id: Optional[int] = None,
    workspace_id: Optional[int] = None,
    entity_id: Optional[str] = None,
    details: Optional[str] = None,
) -> None:
    entry = AuditLog(
        user_id=user_id,
        workspace_id=workspace_id,
        action=action,
        entity=entity,
        entity_id=str(entity_id) if entity_id is not None else None,
        details=details,
    )
    db.add(entry)
    db.commit()

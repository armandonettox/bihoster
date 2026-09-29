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
    user_email = None
    if user_id is not None:
        # Import local: app.models.user importa modelos que podem importar este modulo
        from app.models.user import User

        user = db.query(User).get(user_id)
        user_email = user.email if user else None

    entry = AuditLog(
        user_id=user_id,
        user_email=user_email,
        workspace_id=workspace_id,
        action=action,
        entity=entity,
        entity_id=str(entity_id) if entity_id is not None else None,
        details=details,
    )
    db.add(entry)
    db.commit()

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog

# Janela em que reabrir a mesma coisa (colecao, relatorio) nao grava nova linha de auditoria
VIEW_LOG_WINDOW = timedelta(minutes=10)


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


def log_view_once(
    db: Session,
    action: str,
    entity: str,
    user_id: int,
    entity_id: int | str,
    workspace_id: Optional[int] = None,
    details: Optional[str] = None,
) -> bool:
    """Registra uma visita, mas so se a mesma pessoa nao visitou a mesma coisa nos ultimos
    minutos (VIEW_LOG_WINDOW). Sem isso cada abertura, renovacao de token ou volta de uma tela de
    TV virava uma linha e a tabela crescia sem limite. Devolve True quando gravou."""
    last_view = (
        db.query(func.max(AuditLog.created_at))
        .filter(
            AuditLog.user_id == user_id,
            AuditLog.action == action,
            AuditLog.entity_id == str(entity_id),
        )
        .scalar()
    )
    if last_view is not None:
        # O SQLite devolve datetime sem tzinfo (sempre UTC); normaliza pra comparar sem misturar
        if last_view.tzinfo is not None:
            last_view = last_view.astimezone(timezone.utc).replace(tzinfo=None)
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        if now_utc - last_view < VIEW_LOG_WINDOW:
            return False

    log_action(db, action=action, entity=entity, user_id=user_id, workspace_id=workspace_id, entity_id=entity_id, details=details)
    return True

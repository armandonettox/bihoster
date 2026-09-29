import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core import system_update
from app.core.audit import log_action
from app.core.config import settings
from app.core.database import get_db
from app.core.workspace_deps import require_platform_admin
from app.models.user import User

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/version")
def get_version_status(_=Depends(require_platform_admin)):
    check_failed = False
    try:
        latest = system_update.fetch_latest_release()
    except httpx.HTTPError:
        # GitHub fora do ar ou rate limit -- nao pode derrubar a aba, mas tambem nao pode fingir
        # que "esta atualizado": sinaliza a falha pra interface avisar em vez de mostrar "sem
        # atualizacao".
        latest = None
        check_failed = True

    has_update = bool(latest and system_update.is_newer(latest.version, settings.app_version))
    return {
        "current_version": settings.app_version,
        "latest": latest,
        "has_update": has_update,
        "check_failed": check_failed,
        "auto_update_enabled": system_update.is_auto_update_enabled(),
    }


@router.get("/version/history")
def get_version_history(_=Depends(require_platform_admin)):
    try:
        return system_update.fetch_release_history()
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Nao foi possivel consultar as releases no GitHub agora.")


@router.post("/version/apply")
def apply_update(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    if not system_update.is_auto_update_enabled():
        raise HTTPException(
            status_code=403,
            detail=(
                "Atualizacao automatica esta desligada. Defina ENABLE_AUTO_UPDATE=true no .env "
                "(exige o socket do Docker montado -- ver README) para habilitar."
            ),
        )

    try:
        # Ignora o cache: ao aplicar, a versao precisa ser a real de agora
        latest = system_update.fetch_latest_release(force=True)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Nao foi possivel consultar a ultima versao no GitHub agora.")

    if not latest or not system_update.is_newer(latest.version, settings.app_version):
        raise HTTPException(status_code=400, detail="Nao ha nenhuma versao mais nova disponivel.")

    try:
        log_path = system_update.apply_update(latest.version)
    except system_update.UpdateAlreadyRunning as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    log_action(
        db,
        action="apply_update",
        entity="system",
        user_id=current_user.id,
        details=f"{settings.app_version} -> {latest.version}",
    )

    return {
        "status": "started",
        "target_version": latest.version,
        "log_file": log_path.name,
        "message": "Atualizacao iniciada -- o sistema pode ficar indisponivel por alguns instantes.",
    }


@router.get("/version/logs")
def get_update_logs(_=Depends(require_platform_admin)):
    return system_update.list_update_logs()

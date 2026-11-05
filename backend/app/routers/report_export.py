from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.core import powerbi, report_delivery
from app.core.audit import log_action
from app.core.database import SessionLocal, get_db
from app.core.email_sender import disallowed_recipients, load_smtp_config
from app.core.rate_limit import limiter
from app.core.workspace_deps import require_platform_admin
from app.models.settings import AppSettings
from app.models.user import User
from app.routers import powerbi as embed_router
from app.routers.auth import get_current_user

router = APIRouter(prefix="/workspaces/{workspace_id}/powerbi", tags=["report-export"])


class ExportEmailRequest(BaseModel):
    to: EmailStr
    format: Literal["PDF", "PNG", "PPTX"] = "PDF"


class DeliveryJobOut(BaseModel):
    job_id: str


class DeliveryStatusOut(BaseModel):
    status: str
    message: str
    progress: int


def _audit_result(user_id: int, workspace_id: int, report_id: int, fmt: str, ok: bool, message: str) -> None:
    """Registra o resultado na auditoria, de dentro da thread (abre a propria sessao do banco)."""
    db = SessionLocal()
    try:
        log_action(
            db,
            action="export_email_sent" if ok else "export_email_failed",
            entity="report",
            user_id=user_id,
            workspace_id=workspace_id,
            entity_id=str(report_id),
            details=f"{fmt}, 1 destinatario" if ok else f"{fmt}: {message}"[:300],
        )
    finally:
        db.close()


@router.post("/reports/{report_id}/export-email", response_model=DeliveryJobOut, status_code=202)
@limiter.limit("3/minute")
def export_and_email(
    request: Request,
    workspace_id: int,
    report_id: int,
    data: ExportEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    """Exporta o relatorio e envia por e-mail, em segundo plano. Devolve o id do trabalho, que a tela
    consulta em /export-jobs/{id}. Por enquanto so administradores, e so relatorios sem RLS: o dado
    do beneficiario sai do sistema por e-mail, entao comeca restrito."""
    report = embed_router._get_report_or_404(db, workspace_id, report_id)

    settings_row = db.query(AppSettings).filter(AppSettings.id == 1).first()
    smtp = load_smtp_config(settings_row)
    if smtp is None:
        raise HTTPException(status_code=400, detail="Configure o servidor de e-mail antes de enviar relatorios.")

    recipient = str(data.to)
    if disallowed_recipients(settings_row, [recipient]):
        raise HTTPException(status_code=400, detail="Esse e-mail esta fora dos dominios permitidos.")

    connection = embed_router._get_connection_or_error(db, report)
    static = embed_router.get_report_static_fresh(connection, workspace_id, report)
    if static["needs_identity"]:
        raise HTTPException(
            status_code=400,
            detail="Relatorios com seguranca por linha (RLS) ainda nao podem ser enviados por e-mail.",
        )

    # Valores simples, copiados agora: depois da resposta a sessao do banco fecha e o objeto
    # `current_user` fica solto, entao a thread nunca pode ler atributos dele.
    user_id, user_name = current_user.id, current_user.name
    job = report_delivery.create_job(user_id)
    company = settings_row.company_name if settings_row else "BIHoster"
    conn_snapshot = embed_router._connection_snapshot(connection)
    # Mapeamento nome interno -> nome de exibicao para nomear os arquivos gerados
    page_display_names: dict[str, str] = {}
    try:
        pages = powerbi.list_pages(conn_snapshot, report.pbi_workspace_id, report.pbi_report_id)
        page_display_names = {p["name"]: p["displayName"] for p in pages}
    except Exception:  # noqa: BLE001 -- nomeacao e um extra; nao pode derrubar o envio
        pass
    # Tudo que a thread usa e copiado agora: ela nao pode tocar na sessao do banco desta requisicao
    report_delivery.start_in_background(
        job=job,
        connection=conn_snapshot,
        pbi_workspace_id=report.pbi_workspace_id,
        pbi_report_id=report.pbi_report_id,
        page_names=report.pbi_page_names,
        fmt=data.format,
        report_name=report.name,
        smtp=smtp,
        recipients=[recipient],
        subject=f"{company} - {report.name}",
        body=(
            f"Segue em anexo o relatorio {report.name}.\n\n"
            f"Enviado por {user_name} pelo {company}."
        ),
        page_display_names=page_display_names,
        on_finish=lambda ok, message: _audit_result(user_id, workspace_id, report_id, data.format, ok, message),
    )
    log_action(
        db,
        action="export_email_requested",
        entity="report",
        user_id=user_id,
        workspace_id=workspace_id,
        entity_id=str(report_id),
        details=f"{data.format}, 1 destinatario",  # so a contagem: o endereco nao vai pra auditoria
    )
    return DeliveryJobOut(job_id=job.id)


@router.get("/export-jobs/{job_id}", response_model=DeliveryStatusOut)
def get_export_job(job_id: str, current_user: User = Depends(get_current_user)):
    job = report_delivery.get_job(job_id, current_user.id)
    if job is None:
        raise HTTPException(status_code=404, detail="Envio nao encontrado")
    return DeliveryStatusOut(status=job.status, message=job.message, progress=job.progress)

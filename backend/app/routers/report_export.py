from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core import email_templates, powerbi, report_delivery
from app.core.account_emails import site_base_url
from app.core.audit import log_action
from app.core.database import SessionLocal, get_db
from app.core.email_sender import disallowed_recipients, load_smtp_config
from app.core.rate_limit import limiter
from app.core.access_deps import require_report_permission
from app.models.settings import AppSettings
from app.models.user import User
from app.routers import powerbi as embed_router
from app.routers.auth import get_current_user

router = APIRouter(prefix="/workspaces/{workspace_id}/powerbi", tags=["report-export"])


class ExportEmailRequest(BaseModel):
    to: EmailStr
    format: Literal["PDF", "PNG", "PPTX"] = "PDF"


class ExportDownloadRequest(BaseModel):
    format: Literal["PDF", "PNG", "PPTX"] = "PDF"
    # Vazio = o relatorio inteiro (as paginas escolhidas para ele); com os nomes internos, so essas paginas, na ordem
    # em que vieram. `page_name` (uma so) e do formato antigo da tela e continua aceito.
    page_names: Optional[list[str]] = Field(default=None, max_length=200)
    page_name: Optional[str] = None
    # Estado do relatorio aberto (filtros e selecoes atuais), capturado na tela; vazio = valores padrao do relatorio
    bookmark_state: Optional[str] = Field(default=None, max_length=500_000)


class DeliveryJobOut(BaseModel):
    job_id: str


class DeliveryStatusOut(BaseModel):
    status: str
    message: str
    progress: int
    # So na exportacao para baixar: o nome do arquivo pronto (ainda nao baixado)
    file_name: Optional[str] = None


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
    current_user: User = Depends(require_report_permission("relatorio.exportar")),
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
    email_subject = f"{company} - {report.name}"
    email_body = f"Segue em anexo o relatorio {report.name}.\n\nEnviado por {user_name} pelo {company}."
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
        subject=email_subject,
        body=email_body,
        html=email_templates.html_for_message(settings_row, site_base_url(settings_row), email_subject, email_body),
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
    return DeliveryStatusOut(
        status=job.status,
        message=job.message,
        progress=job.progress,
        file_name=job.file_name if job.file_data is not None else None,
    )


def _audit_download(user_id: int, workspace_id: int, report_id: int, fmt: str, ok: bool, message: str) -> None:
    db = SessionLocal()
    try:
        log_action(
            db,
            action="export_download_done" if ok else "export_download_failed",
            entity="report",
            user_id=user_id,
            workspace_id=workspace_id,
            entity_id=str(report_id),
            details=fmt if ok else f"{fmt}: {message}"[:300],
        )
    finally:
        db.close()


@router.post("/reports/{report_id}/export-download", response_model=DeliveryJobOut, status_code=202)
@limiter.limit("6/minute")
def export_for_download(
    request: Request,
    workspace_id: int,
    report_id: int,
    data: ExportDownloadRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_report_permission("relatorio.exportar")),
):
    """Exporta o relatorio (ou uma pagina) em PDF, PowerPoint ou imagem, em segundo plano, para a pessoa baixar. Devolve o id do
    trabalho: a tela acompanha em /export-jobs/{id} e baixa o arquivo em /export-jobs/{id}/file. Mesmas regras do envio
    por e-mail: permissao de exportar e relatorio sem RLS, porque o dado sai do sistema."""
    report = embed_router._get_report_or_404(db, workspace_id, report_id)
    connection = embed_router._get_connection_or_error(db, report)
    static = embed_router.get_report_static_fresh(connection, workspace_id, report)
    if static["needs_identity"]:
        raise HTTPException(
            status_code=400,
            detail="Relatorios com seguranca por linha (RLS) ainda nao podem ser exportados.",
        )

    user_id = current_user.id
    job = report_delivery.create_job(user_id)
    conn_snapshot = embed_router._connection_snapshot(connection)
    page_display_names: dict[str, str] = {}
    try:
        pages = powerbi.list_pages(conn_snapshot, report.pbi_workspace_id, report.pbi_report_id)
        page_display_names = {p["name"]: p["displayName"] for p in pages}
    except Exception:  # noqa: BLE001 -- nomear pelo nome da pagina e um extra; nao pode derrubar a exportacao
        pass
    # Sem repetidas, mantendo a ordem pedida
    requested = list(dict.fromkeys(data.page_names or ([data.page_name] if data.page_name else [])))
    if requested:
        if page_display_names and any(name not in page_display_names for name in requested):
            raise HTTPException(status_code=400, detail="Pagina nao encontrada neste relatorio.")
        page_names = requested
    else:
        page_names = list(report.pbi_page_names or [])
    fmt = data.format
    report_delivery.start_download_in_background(
        job=job,
        connection=conn_snapshot,
        pbi_workspace_id=report.pbi_workspace_id,
        pbi_report_id=report.pbi_report_id,
        page_names=page_names,
        fmt=fmt,
        report_name=report.name,
        page_display_names=page_display_names,
        on_finish=lambda ok, message: _audit_download(user_id, workspace_id, report_id, fmt, ok, message),
        bookmark_state=data.bookmark_state or None,
    )
    log_action(
        db,
        action="export_download_requested",
        entity="report",
        user_id=user_id,
        workspace_id=workspace_id,
        entity_id=str(report_id),
        details=fmt
        + (", relatorio" if not requested else ", pagina" if len(requested) == 1 else f", {len(requested)} paginas")
        + (", valores atuais" if data.bookmark_state else ""),
    )
    return DeliveryJobOut(job_id=job.id)


@router.get("/export-jobs/{job_id}/file")
def download_export_file(job_id: str, current_user: User = Depends(get_current_user)):
    """O arquivo da exportacao pronta. So quem pediu baixa, e o arquivo sai da memoria depois do primeiro download."""
    job = report_delivery.get_job(job_id, current_user.id)
    if job is None or job.file_data is None:
        raise HTTPException(status_code=404, detail="Arquivo nao encontrado ou ja baixado")
    data, name, mimetype = job.file_data, job.file_name or "relatorio", job.file_mimetype or "application/octet-stream"
    job.file_data = None
    return Response(
        content=data,
        media_type=mimetype,
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )

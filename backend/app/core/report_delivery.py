"""Exportar um relatorio do Power BI e enviar por e-mail, em segundo plano.

A exportacao leva de segundos a minutos, mais do que o proxy aceita esperar numa unica requisicao,
entao o envio roda numa thread e a tela acompanha pelo id do trabalho. A mesma funcao serve depois
para as assinaturas agendadas.

Os trabalhos ficam so na memoria do processo (o backend roda com um unico worker): sao um
acompanhamento de curta duracao, nao um historico. O historico de verdade vai pra auditoria."""

import io
import logging
import re
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from typing import Callable, Optional, Sequence

from app.core import powerbi
from app.core.email_sender import Attachment, EmailError, SmtpConfig, send_email

logger = logging.getLogger(__name__)

# No maximo duas exportacoes ao mesmo tempo: a capacidade do Power BI limita as exportacoes e
# disparar muitas de uma vez so faz as proximas serem recusadas.
_export_slots = threading.BoundedSemaphore(2)
_JOB_TTL_SECONDS = 3600
_MAX_JOBS = 100


@dataclass
class DeliveryJob:
    id: str
    user_id: int
    status: str = "queued"  # queued, exporting, sending, done, error
    message: str = "Na fila."
    progress: int = 0
    created_at: float = field(default_factory=time.monotonic)

    @property
    def finished(self) -> bool:
        return self.status in ("done", "error")


_jobs: dict[str, DeliveryJob] = {}
_jobs_lock = threading.Lock()


def _prune_jobs() -> None:
    now = time.monotonic()
    for job_id in [j for j, job in _jobs.items() if job.finished and now - job.created_at > _JOB_TTL_SECONDS]:
        _jobs.pop(job_id, None)
    # Teto de seguranca: descarta os mais antigos ja terminados
    while len(_jobs) > _MAX_JOBS:
        finished = sorted((j for j in _jobs.values() if j.finished), key=lambda j: j.created_at)
        if not finished:
            break
        _jobs.pop(finished[0].id, None)


def create_job(user_id: int) -> DeliveryJob:
    job = DeliveryJob(id=uuid.uuid4().hex, user_id=user_id)
    with _jobs_lock:
        _jobs[job.id] = job
        _prune_jobs()  # depois de inserir: o teto vale tambem com o trabalho novo
    return job


def get_job(job_id: str, user_id: int) -> Optional[DeliveryJob]:
    """O trabalho so e visivel a quem o criou."""
    with _jobs_lock:
        job = _jobs.get(job_id)
    return job if job is not None and job.user_id == user_id else None


def safe_filename(name: str, extension: str) -> str:
    """Nome de arquivo sem caracteres que atrapalham (barras, aspas, quebras de linha)."""
    spaced = re.sub(r"\s+", " ", name)  # quebras de linha e tabs viram espaco, nao somem
    cleaned = re.sub(r"[^\w\- ]+", "", spaced, flags=re.UNICODE).strip()
    return f"{(cleaned or 'relatorio')[:80]}{extension}"


def _rename_zip_pages(data: bytes, display_names: dict[str, str]) -> bytes:
    """Renomeia as imagens dentro do ZIP usando os nomes de exibicao das paginas.

    O Power BI nomeia cada arquivo com o nome interno da pagina (ex: ReportSection1a2b).
    Se houver mapeamento disponivel, troca pelo nome de exibicao legivel."""
    if not display_names:
        return data
    src = io.BytesIO(data)
    dst = io.BytesIO()
    with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for entry in zin.infolist():
            content = zin.read(entry.filename)
            if "." in entry.filename:
                stem, ext = entry.filename.rsplit(".", 1)
                display = display_names.get(stem)
                new_name = safe_filename(display, f".{ext}") if display else entry.filename
            else:
                new_name = entry.filename
            zout.writestr(new_name, content)
    return dst.getvalue()


def run_delivery(
    job: DeliveryJob,
    *,
    connection,
    pbi_workspace_id: str,
    pbi_report_id: str,
    page_names: Sequence[str],
    fmt: str,
    report_name: str,
    smtp: SmtpConfig,
    recipients: Sequence[str],
    subject: str,
    body: str,
    page_display_names: Optional[dict[str, str]] = None,
    on_finish: Optional[Callable[[bool, str], None]] = None,
) -> None:
    """Exporta e envia. Nunca levanta: o resultado vai para o trabalho (e para `on_finish`).

    `page_display_names` mapeia nome interno -> nome de exibicao para nomear os arquivos gerados."""
    ok = False
    display = page_display_names or {}
    try:
        job.status, job.message = "queued", "Esperando vaga para exportar."
        with _export_slots:
            job.status, job.message = "exporting", "Exportando o relatorio no Power BI..."

            def progress(percent: int) -> None:
                job.progress = percent

            data = powerbi.export_report(
                connection, pbi_workspace_id, pbi_report_id, fmt, list(page_names) or None, on_progress=progress
            )
        job.status, job.message = "sending", "Enviando o e-mail..."
        mimetype, extension = powerbi.EXPORT_FORMATS[fmt]
        if fmt == "PNG" and data[:2] == b"PK":
            # Relatorio com varias paginas: o Power BI entrega um zip com uma imagem por pagina
            mimetype, extension = "application/zip", ".zip"
            data = _rename_zip_pages(data, display)
            attachment_name = safe_filename(report_name, ".zip")
        elif fmt == "PNG" and len(page_names) == 1 and page_names[0] in display:
            # Pagina unica selecionada: nomeia pelo nome de exibicao da pagina
            attachment_name = safe_filename(display[page_names[0]], ".png")
        else:
            attachment_name = safe_filename(report_name, extension)
        send_email(
            smtp,
            list(recipients),
            subject,
            body,
            [Attachment(attachment_name, data, mimetype)],
        )
        job.status, job.message, job.progress = "done", "E-mail enviado.", 100
        ok = True
    except (powerbi.PowerBIError, EmailError) as exc:
        job.status, job.message = "error", str(exc)
    except Exception:  # noqa: BLE001 -- a thread nunca pode morrer sem registrar o resultado
        logger.exception("falha inesperada ao enviar relatorio por e-mail")
        job.status, job.message = "error", "Erro inesperado ao enviar o relatorio."
    finally:
        if on_finish is not None:
            try:
                on_finish(ok, job.message)
            except Exception:  # noqa: BLE001
                logger.exception("falha ao registrar o resultado do envio")


def start_in_background(**kwargs) -> threading.Thread:
    thread = threading.Thread(target=run_delivery, kwargs=kwargs, name="report-delivery", daemon=True)
    thread.start()
    return thread

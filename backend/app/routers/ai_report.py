from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core import ai_report_settings, chat_dataset, chat_images
from app.core.ai_access import require_ai_manage, require_ai_use
from app.core.audit import log_action
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.core.workspace_deps import get_effective_role
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.user import User
from app.schemas.ai_report import (
    AIReportSchemaOut,
    AIReportSettingsOut,
    AIReportSettingsUpdate,
    AISchemaColumnOut,
    AISchemaTableOut,
    BlockedColumn,
    PageImageIn,
    PageImageOut,
)

router = APIRouter(prefix="/ai/reports", tags=["ai-report"])


def _get_report(db: Session, user: User, report_id: int) -> Report:
    """Quem gerencia a IA e tem acesso a colecao do relatorio. Mesma resposta para "nao existe" e
    "sem acesso": nao revela que o relatorio existe."""
    report = db.query(Report).get(report_id)
    if report is None or get_effective_role(db, user.id, report.collection_id) is None:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")
    return report


def _settings_out(report: Report, settings: ai_report_settings.ReportAISettings) -> AIReportSettingsOut:
    return AIReportSettingsOut(
        report_id=report.id,
        report_name=report.name,
        notes=settings.notes,
        blocked_columns=[BlockedColumn(table=t, column=c) for t, c in settings.blocked],
        allow_images=settings.allow_images,
    )


@router.get("/{report_id}/schema", response_model=AIReportSchemaOut)
@limiter.limit("10/minute")
def get_report_schema(
    request: Request,
    report_id: int,
    refresh: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ai_manage),
):
    """Mostra o que a IA enxerga do relatorio: tabelas, colunas (com tipo e quantidade de valores diferentes),
    medidas, o que ficou de fora por tamanho e quantas colunas ocultas ela ignora. So nomes e contagens, nunca
    linhas. `refresh` esquece o esquema guardado e le o Power BI de novo."""
    report = _get_report(db, current_user, report_id)
    max_chars = chat_dataset.MAX_SCHEMA_CHARS

    def empty(reason: str, eligible: bool = False) -> AIReportSchemaOut:
        return AIReportSchemaOut(
            report_id=report.id,
            report_name=report.name,
            eligible=eligible,
            reason=reason,
            tables=None,
            prompt_chars=0,
            prompt_max_chars=max_chars,
            omitted_tables=[],
            omitted_columns=0,
            hidden_columns=0,
        )

    connection = db.query(PowerBIConnection).get(report.powerbi_connection_id) if report.powerbi_connection_id else None
    if connection is None:
        return empty("Este relatorio nao tem uma conta do Power BI configurada.")

    eligibility = chat_dataset.check_eligibility(connection, report)
    if not eligibility.ok:
        return empty(eligibility.reason or chat_dataset.REASON_UNKNOWN)

    if refresh:
        chat_dataset.clear_schema_cache(connection, report)
    try:
        schema = chat_dataset.get_dataset_schema(connection, report)
    except chat_dataset.ChatDataError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    settings = ai_report_settings.get_settings(db, report.id)
    blocked = {(t.lower(), c.lower()) for t, c in settings.blocked}
    prompt = chat_dataset.build_schema_prompt(schema, max_chars, settings.blocked)
    shown = set(prompt.shown_tables)

    tables = [
        AISchemaTableOut(
            name=table.name,
            columns=[
                AISchemaColumnOut(
                    name=c.name,
                    data_type=c.data_type,
                    distinct=c.distinct,
                    blocked=(table.name.lower(), c.name.lower()) in blocked,
                )
                for c in table.columns
            ],
            measures=[name for name, _ in table.measures],
            in_prompt=table.name in shown,
        )
        for table in schema.tables
    ]
    return AIReportSchemaOut(
        report_id=report.id,
        report_name=report.name,
        eligible=True,
        reason=None,
        tables=tables,
        prompt_chars=len(prompt.text),
        prompt_max_chars=max_chars,
        omitted_tables=list(prompt.omitted_tables),
        omitted_columns=prompt.omitted_columns,
        hidden_columns=schema.hidden_columns,
    )


@router.post("/{report_id}/page-image", response_model=PageImageOut)
@limiter.limit("20/minute")
def warm_page_image(
    request: Request,
    report_id: int,
    data: PageImageIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ai_use),
):
    """Pede a imagem da pagina aberta do relatorio, para a IA ver os graficos. Nao espera: a exportacao roda em
    segundo plano e as proximas perguntas usam a imagem quando ela estiver pronta. So acontece se o admin
    liberou imagens neste relatorio e ele passou na checagem de RLS; senao responde "disabled" sem exportar nada."""
    report = _get_report(db, current_user, report_id)
    if not ai_report_settings.get_settings(db, report.id).allow_images:
        return PageImageOut(state="disabled")
    connection = db.query(PowerBIConnection).get(report.powerbi_connection_id) if report.powerbi_connection_id else None
    if connection is None or not chat_dataset.check_eligibility(connection, report).ok:
        return PageImageOut(state="disabled")
    return PageImageOut(state=chat_images.warm(connection, report, data.page_name))


@router.get("/{report_id}/settings", response_model=AIReportSettingsOut)
def get_report_settings(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ai_manage),
):
    report = _get_report(db, current_user, report_id)
    return _settings_out(report, ai_report_settings.get_settings(db, report.id))


@router.put("/{report_id}/settings", response_model=AIReportSettingsOut)
def update_report_settings(
    report_id: int,
    data: AIReportSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ai_manage),
):
    """Grava as orientacoes, as colunas bloqueadas e a permissao de imagem do relatorio."""
    report = _get_report(db, current_user, report_id)
    saved = ai_report_settings.save_settings(
        db, report.id, data.notes, [(b.table, b.column) for b in data.blocked_columns], data.allow_images
    )
    # So os numeros: as orientacoes e os nomes das colunas nao vao para a auditoria
    log_action(
        db,
        action="update_ai_report_settings",
        entity="report",
        user_id=current_user.id,
        workspace_id=report.collection_id,
        entity_id=report.id,
        details=(
            f"orientacoes={len(saved.notes)} caracteres; colunas bloqueadas={len(saved.blocked)}; "
            f"imagens={'sim' if saved.allow_images else 'nao'}"
        ),
    )
    return _settings_out(report, saved)

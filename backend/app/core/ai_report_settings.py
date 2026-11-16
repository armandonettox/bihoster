"""Configuracoes de IA por relatorio: orientacoes, colunas bloqueadas e imagem da pagina."""

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.models.ai_report_settings import AIReportSettings

MAX_NOTES_CHARS = 2000
MAX_BLOCKED_COLUMNS = 300
MAX_NAME_CHARS = 200

REVIEW_PENDING = "pending"  # relatorio novo: o chat nao o consulta ate o admin revisar as colunas
REVIEW_DONE = "reviewed"


@dataclass(frozen=True)
class ReportAISettings:
    notes: str = ""
    blocked: tuple[tuple[str, str], ...] = ()  # (tabela, coluna)
    allow_images: bool = False
    review_status: Optional[str] = None

    @property
    def chat_closed(self) -> bool:
        """O chat nao consulta o relatorio: e novo e o admin ainda nao revisou as colunas."""
        return self.review_status == REVIEW_PENDING

    @property
    def review(self) -> str:
        """Estado de revisao para mostrar ao admin: reviewed, pending (fechado) ou unreviewed (aberto, de antes
        da revisao)."""
        if self.review_status == REVIEW_DONE:
            return "reviewed"
        return "pending" if self.chat_closed else "unreviewed"


def _parse_blocked(raw: Optional[str]) -> tuple[tuple[str, str], ...]:
    if not raw:
        return ()
    try:
        items = json.loads(raw)
    except ValueError:
        return ()
    result: list[tuple[str, str]] = []
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and isinstance(item.get("table"), str) and isinstance(item.get("column"), str):
            result.append((item["table"], item["column"]))
    return tuple(result)


def get_settings(db: Session, report_id: int) -> ReportAISettings:
    row = db.query(AIReportSettings).filter(AIReportSettings.report_id == report_id).first()
    if row is None:
        return ReportAISettings()
    return ReportAISettings(
        notes=row.notes or "",
        blocked=_parse_blocked(row.blocked_columns_json),
        allow_images=bool(row.allow_images),
        review_status=row.review_status,
    )


def review_states(db: Session, report_ids: Iterable[int]) -> dict[int, str]:
    """Estado de revisao (reviewed, pending ou unreviewed) de cada relatorio, numa consulta so."""
    ids = list(report_ids)
    if not ids:
        return {}
    rows = db.query(AIReportSettings.report_id, AIReportSettings.review_status).filter(AIReportSettings.report_id.in_(ids)).all()
    status = dict(rows)
    return {report_id: ReportAISettings(review_status=status.get(report_id)).review for report_id in ids}


def mark_review_pending(db: Session, report_id: int) -> None:
    """Relatorio novo nasce fechado ao chat. Nao faz commit: quem cria o relatorio grava os dois de uma vez, para
    nao existir um instante com o relatorio aberto."""
    row = db.query(AIReportSettings).filter(AIReportSettings.report_id == report_id).first()
    if row is None:
        db.add(AIReportSettings(report_id=report_id, review_status=REVIEW_PENDING))
    else:
        row.review_status = REVIEW_PENDING


def mark_reviewed(db: Session, report_id: int) -> ReportAISettings:
    """O admin revisou as colunas (com ou sem bloqueio): libera o relatorio para o chat."""
    row = db.query(AIReportSettings).filter(AIReportSettings.report_id == report_id).first()
    if row is None:
        row = AIReportSettings(report_id=report_id)
        db.add(row)
    row.review_status = REVIEW_DONE
    row.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    return get_settings(db, report_id)


def save_settings(
    db: Session, report_id: int, notes: str, blocked: Iterable[tuple[str, str]], allow_images: bool
) -> ReportAISettings:
    """Grava as configuracoes do relatorio (uma linha por relatorio). Colunas repetidas contam uma vez."""
    unique: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for table, column in blocked:
        key = (table.lower(), column.lower())
        if key not in seen:
            seen.add(key)
            unique.append((table, column))

    row = db.query(AIReportSettings).filter(AIReportSettings.report_id == report_id).first()
    if row is None:
        row = AIReportSettings(report_id=report_id)
        db.add(row)
    row.notes = notes.strip() or None
    row.blocked_columns_json = json.dumps([{"table": t, "column": c} for t, c in unique], ensure_ascii=False) if unique else None
    row.allow_images = allow_images
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return get_settings(db, report_id)


def delete_settings_of_reports(db: Session, report_ids: Iterable[int]) -> None:
    """Apaga as configuracoes de IA dos relatorios (sem confirmar: quem chama faz o commit)."""
    ids = list(report_ids)
    if ids:
        db.query(AIReportSettings).filter(AIReportSettings.report_id.in_(ids)).delete(synchronize_session=False)

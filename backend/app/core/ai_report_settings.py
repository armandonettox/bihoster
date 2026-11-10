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


@dataclass(frozen=True)
class ReportAISettings:
    notes: str = ""
    blocked: tuple[tuple[str, str], ...] = ()  # (tabela, coluna)
    allow_images: bool = False


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
    )


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

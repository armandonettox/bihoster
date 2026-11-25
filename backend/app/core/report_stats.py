"""Aberturas de relatorio por hora (v1.54.0): conta cada abertura (so a contagem) e responde "quais relatorios foram abertos
nas ultimas horas" para o aquecimento e "quantas aberturas por hora" para a tela."""

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.report import Report
from app.models.report_open_stat import ReportOpenStat

KEEP_DAYS = 30
DEFAULT_RECENT_HOURS = 72


def hour_key(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H")


def record_open(db: Session, report_id: int, now: datetime | None = None) -> None:
    """Soma uma abertura na hora atual. Nunca derruba o carregamento do relatorio: erro aqui e engolido."""
    try:
        key = hour_key(now or datetime.now(timezone.utc))
        row = db.query(ReportOpenStat).filter(ReportOpenStat.report_id == report_id, ReportOpenStat.hour == key).first()
        if row is None:
            db.add(ReportOpenStat(report_id=report_id, hour=key, opens=1))
        else:
            row.opens = (row.opens or 0) + 1
        db.commit()
    except Exception:  # noqa: BLE001 - estatistica nao pode atrapalhar o uso
        db.rollback()


def recent_report_ids(db: Session, hours: int, now: datetime | None = None) -> set[int]:
    """Os relatorios abertos pelo menos uma vez nas ultimas `hours` horas."""
    since = hour_key((now or datetime.now(timezone.utc)) - timedelta(hours=max(1, hours)))
    return {row[0] for row in db.query(ReportOpenStat.report_id).filter(ReportOpenStat.hour >= since).distinct()}


def openings(db: Session, hours: int = 24, limit: int = 20, now: datetime | None = None) -> dict:
    """Aberturas por relatorio e por hora nas ultimas `hours` horas: os `limit` mais abertos, cada um com a serie por hora."""
    moment = now or datetime.now(timezone.utc)
    since = hour_key(moment - timedelta(hours=max(1, hours)))
    rows = db.query(ReportOpenStat).filter(ReportOpenStat.hour >= since).all()
    totals: dict[int, int] = {}
    series: dict[int, dict[str, int]] = {}
    for row in rows:
        totals[row.report_id] = totals.get(row.report_id, 0) + (row.opens or 0)
        series.setdefault(row.report_id, {})[row.hour] = row.opens or 0
    top = sorted(totals, key=lambda rid: (-totals[rid], rid))[:limit]
    names = {r.id: r.name for r in db.query(Report).filter(Report.id.in_(top or [-1]))}
    return {
        "hours": hours,
        "reports": [
            {"report_id": rid, "report_name": names.get(rid, "(relatorio removido)"), "total": totals[rid], "by_hour": dict(sorted(series[rid].items()))}
            for rid in top
        ],
    }


def prune(db: Session, now: datetime | None = None) -> int:
    """Apaga contagens com mais de KEEP_DAYS dias."""
    limit = hour_key((now or datetime.now(timezone.utc)) - timedelta(days=KEEP_DAYS))
    count = db.query(ReportOpenStat).filter(ReportOpenStat.hour < limit).delete(synchronize_session=False)
    db.commit()
    return count

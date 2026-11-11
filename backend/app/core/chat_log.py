"""Registro do chat de IA para o admin: grava cada pergunta (respondida ou nao), consulta com filtros,
resume o desempenho por modelo e apaga o que passou do prazo. Gravar nunca derruba a pergunta."""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.ai_chat_log import AIChatLog

logger = logging.getLogger(__name__)

LOG_RETENTION_DAYS = 30
MAX_QUESTION_CHARS = 1000
MAX_REPLY_CHARS = 2000
MAX_DAX_CHARS = 4000
MAX_ERROR_CHARS = 500
MAX_PERIOD_ROWS = 20000  # limite de linhas lidas para o resumo
PAGE_SIZE = 50
MAX_PAGE_SIZE = 100

# Desfechos que o admin quer rever: a IA nao respondeu com dados ou deu erro. "blocked" (relatorio com RLS,
# sem acesso) fica de fora: e esperado. "no_reports" e pessoa sem relatorio, tambem esperado.
PROBLEM_OUTCOMES = ("model_reply", "off_topic", "needs_detail", "no_dax", "no_report", "empty_answer", "error")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _cut(text: Optional[str], limit: int) -> Optional[str]:
    if text is None:
        return None
    return text if len(text) <= limit else text[: limit - 3] + "..."


def record(
    db: Session,
    *,
    user,
    conversation_id: Optional[int],
    provider: str,
    model: str,
    question: str,
    duration_ms: int,
    trace: list,
    answer=None,
    error: Optional[str] = None,
) -> None:
    """Grava uma pergunta. `answer` e o ChatAnswer quando houve resposta; `error` e a mensagem quando a
    pergunta falhou (nesse caso o desfecho e "error" e os numeros saem do `trace`). Nunca levanta: se gravar
    falhar, o motivo vai para o log do servidor e a pergunta segue."""
    try:
        if answer is not None:
            outcome = answer.outcome
            llm_calls, input_tokens, output_tokens = answer.llm_calls, answer.input_tokens, answer.output_tokens
            report = answer.report
            reply, dax, used_image = answer.reply, answer.dax, answer.used_image
        else:
            outcome = "error"
            done = [t for t in trace if "text_chars" in t]
            llm_calls = len(done)
            input_tokens = sum(t.get("input_tokens", 0) for t in done)
            output_tokens = sum(t.get("output_tokens", 0) for t in done)
            report, reply, dax, used_image = None, None, None, False
        db.add(
            AIChatLog(
                created_at=_now(),
                user_id=user.id,
                user_email=user.email,
                conversation_id=conversation_id,
                provider=provider,
                model=model,
                report_id=report.id if report else None,
                report_name=report.name if report else None,
                outcome=outcome,
                error=_cut(error, MAX_ERROR_CHARS),
                duration_ms=max(0, int(duration_ms)),
                llm_calls=llm_calls,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                used_image=used_image,
                question=_cut(question, MAX_QUESTION_CHARS),
                reply=_cut(reply, MAX_REPLY_CHARS),
                dax=_cut(dax, MAX_DAX_CHARS),
                steps_json=json.dumps(trace, ensure_ascii=False) if trace else None,
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001 -- o registro e secundario: nunca pode atrapalhar a resposta
        db.rollback()
        logger.warning("nao foi possivel gravar o registro do chat de IA", exc_info=True)


def parse_steps(raw: Optional[str]) -> list[dict]:
    if not raw:
        return []
    try:
        steps = json.loads(raw)
    except ValueError:
        return []
    return [s for s in steps if isinstance(s, dict)] if isinstance(steps, list) else []


def _since(days: int) -> datetime:
    return _now() - timedelta(days=days)


def list_entries(
    db: Session,
    days: int,
    only_problems: bool = False,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    before_id: Optional[int] = None,
    limit: int = PAGE_SIZE,
) -> tuple[list[AIChatLog], Optional[int]]:
    """Do mais novo para o mais antigo. Devolve as linhas e o `before_id` da proxima pagina (None se acabou)."""
    limit = max(1, min(limit, MAX_PAGE_SIZE))
    query = db.query(AIChatLog).filter(AIChatLog.created_at >= _since(days))
    if only_problems:
        query = query.filter(AIChatLog.outcome.in_(PROBLEM_OUTCOMES))
    if provider:
        query = query.filter(AIChatLog.provider == provider)
    if model:
        query = query.filter(AIChatLog.model == model)
    if before_id is not None:
        query = query.filter(AIChatLog.id < before_id)
    rows = query.order_by(AIChatLog.id.desc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    return rows, (rows[-1].id if has_more and rows else None)


def _percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round(fraction * (len(ordered) - 1)))))
    return ordered[index]


def summarize(db: Session, days: int) -> list[dict]:
    """Por provedor e modelo no periodo: perguntas, quantas terminaram em problema, tempo medio e p95 (em ms)."""
    rows = (
        db.query(AIChatLog.provider, AIChatLog.model, AIChatLog.outcome, AIChatLog.duration_ms)
        .filter(AIChatLog.created_at >= _since(days))
        .order_by(AIChatLog.id.desc())
        .limit(MAX_PERIOD_ROWS)
        .all()
    )
    groups: dict[tuple[str, str], list[tuple[str, int]]] = {}
    for provider, model, outcome, duration in rows:
        groups.setdefault((provider, model), []).append((outcome, duration or 0))
    stats = []
    for (provider, model), items in groups.items():
        durations = [d for _, d in items]
        stats.append(
            {
                "provider": provider,
                "model": model,
                "questions": len(items),
                "problems": sum(1 for outcome, _ in items if outcome in PROBLEM_OUTCOMES),
                "avg_ms": int(sum(durations) / len(durations)),
                "p95_ms": _percentile(durations, 0.95),
            }
        )
    return sorted(stats, key=lambda s: s["questions"], reverse=True)


def purge_expired(db: Session, now: Optional[datetime] = None) -> int:
    """Apaga o que passou de LOG_RETENTION_DAYS. Devolve quantas linhas."""
    cutoff = (now or _now()) - timedelta(days=LOG_RETENTION_DAYS)
    removed = db.query(AIChatLog).filter(AIChatLog.created_at < cutoff).delete(synchronize_session=False)
    db.commit()
    return removed

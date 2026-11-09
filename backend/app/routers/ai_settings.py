import time

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core import ai_providers
from app.core.ai_access import require_ai_manage
from app.core.ai_providers import PROVIDERS, AIError
from app.core.audit import log_action
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models.ai_provider import AIProvider
from app.models.user import User
from app.schemas.ai_settings import AIProviderOut, AIProviderTestOut, AIProviderUpdate

# Rotas proprias, so para quem tem a permissao "Gerenciar IA" (grupos; administradores sempre tem):
# a chave de API nunca sai por aqui nem pela rota publica de configuracoes.
router = APIRouter(prefix="/settings/ai", tags=["ai-settings"])


def _get_provider_or_404(provider: str):
    info = PROVIDERS.get(provider)
    if info is None:
        raise HTTPException(status_code=404, detail="Provedor de IA desconhecido.")
    return info


def _to_out(provider: str, row: AIProvider | None) -> AIProviderOut:
    info = PROVIDERS[provider]
    return AIProviderOut(
        provider=info.key,
        label=info.label,
        example_model=info.example_model,
        api_key_configured=bool(row and row.api_key),
        model=row.model if row else None,
        enabled=bool(row and row.enabled),
        chat_default=bool(row and row.enabled and row.is_chat_default),
    )


@router.get("/", response_model=list[AIProviderOut])
def list_ai_providers(db: Session = Depends(get_db), _: User = Depends(require_ai_manage)):
    rows = {row.provider: row for row in db.query(AIProvider).all()}
    return [_to_out(key, rows.get(key)) for key in PROVIDERS]


@router.put("/{provider}", response_model=AIProviderOut)
def update_ai_provider(
    provider: str,
    data: AIProviderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ai_manage),
):
    _get_provider_or_404(provider)
    row = db.query(AIProvider).filter(AIProvider.provider == provider).first()
    if row is None:
        row = AIProvider(provider=provider, enabled=False)
        db.add(row)

    changed = data.model_dump(exclude_unset=True)
    updated = set(changed)

    if "api_key" in changed:
        row.api_key = changed["api_key"] or None  # texto vazio apaga
        if not row.api_key:
            row.enabled = False  # sem chave nao ha como ficar ativo
    if "model" in changed:
        row.model = changed["model"] or None
    if "enabled" in changed and changed["enabled"] is not None:
        if changed["enabled"] and not (row.api_key and row.model):
            db.rollback()
            raise HTTPException(status_code=400, detail="Informe a chave e o modelo antes de ativar o provedor.")
        row.enabled = changed["enabled"]
    if "chat_default" in changed and changed["chat_default"] is not None:
        if changed["chat_default"]:
            if not row.enabled:
                db.rollback()
                raise HTTPException(status_code=400, detail="Ative o provedor antes de escolhe-lo para o chat.")
            # So um provedor responde o chat: o escolhido agora tira a marca dos outros
            db.query(AIProvider).filter(AIProvider.provider != provider).update(
                {"is_chat_default": False}, synchronize_session=False
            )
        row.is_chat_default = changed["chat_default"]
    if not row.enabled:
        row.is_chat_default = False  # desativar ou apagar a chave tira o provedor do chat

    db.commit()
    db.refresh(row)

    log_action(
        db,
        action="update_ai_provider",
        entity="ai_provider",
        user_id=current_user.id,
        entity_id=provider,
        details=", ".join(sorted(updated)),  # so os nomes dos campos, nunca os valores
    )
    return _to_out(provider, row)


@router.post("/{provider}/test", response_model=AIProviderTestOut)
@limiter.limit("5/minute")
def test_ai_provider(
    request: Request,
    provider: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ai_manage),
):
    _get_provider_or_404(provider)
    row = db.query(AIProvider).filter(AIProvider.provider == provider).first()
    if row is None or not row.api_key or not row.model:
        raise HTTPException(status_code=400, detail="Salve a chave e o modelo antes de testar.")

    started = time.monotonic()
    try:
        ai_providers.complete(
            provider,
            row.api_key,
            row.model,
            [{"role": "user", "content": "Responda apenas: ok"}],
            max_tokens=16,
        )
    except AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    latency_ms = int((time.monotonic() - started) * 1000)

    log_action(db, action="test_ai_provider", entity="ai_provider", user_id=current_user.id, entity_id=provider)
    return AIProviderTestOut(ok=True, model=row.model, latency_ms=latency_ms)

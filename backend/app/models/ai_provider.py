from sqlalchemy import Boolean, Column, Integer, String

from app.core.crypto import EncryptedString
from app.core.database import Base


class AIProvider(Base):
    """Um provedor de IA (OpenAI, Gemini, Anthropic, OpenRouter, NVIDIA) com a chave cadastrada pelo
    administrador. Uma linha por provedor, criada so quando o admin salva algo.

    E tabela nova, entao o create_all() cria sozinho; colunas novas daqui pra frente seguem a regra
    do projeto (nullable)."""

    __tablename__ = "ai_providers"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String, unique=True, nullable=False, index=True)  # chave do catalogo em core/ai_providers.py
    api_key = Column(EncryptedString, nullable=True)  # cifrada em repouso, nunca devolvida pela API
    model = Column(String, nullable=True)
    enabled = Column(Boolean, default=False, nullable=False)
    # Provedor que responde o chat. So um por vez e so entre os ativos. Nullable de proposito: a
    # migracao automatica do boot so adiciona colunas nulaveis (a tabela ja existe em instalacoes).
    is_chat_default = Column(Boolean, nullable=True)

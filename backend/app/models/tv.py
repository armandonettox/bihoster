from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class Tv(Base):
    """Uma TV cadastrada no Modo TV: tem a propria lista de itens, o link secreto e o codigo de acesso.

    `link_secret` vai na URL que a TV abre. `code_secret` nunca sai do servidor: dele sai o codigo de 6 digitos que
    muda com o tempo e que a TV precisa digitar ao conectar (ver core/tv.py). A conexao da TV e um token assinado;
    `sessions_revoked_at` corta todos os tokens emitidos antes dele (desconectar a TV ou trocar o link).
    `session_hours` vazio = a TV fica conectada para sempre. E tabela nova, entao o create_all() cria sozinho."""

    __tablename__ = "tvs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    link_secret = Column(String, nullable=False, unique=True, index=True)
    code_secret = Column(String, nullable=False)
    session_hours = Column(Integer, nullable=True)
    # De quantos em quantos minutos a TV atualiza os dados dos relatorios (vazio = nao atualiza sozinha)
    refresh_minutes = Column(Integer, nullable=True)
    sessions_revoked_at = Column(DateTime(timezone=True), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    items = relationship("TvItem", order_by="TvItem.position", cascade="all, delete-orphan", back_populates="tv")


class TvItem(Base):
    """Um item da lista da TV: uma pagina de um relatorio, uma imagem ou um video do YouTube, cada um com o seu tempo."""

    __tablename__ = "tv_items"

    id = Column(Integer, primary_key=True, index=True)
    tv_id = Column(Integer, ForeignKey("tvs.id", ondelete="CASCADE"), nullable=False, index=True)
    position = Column(Integer, nullable=False, default=0)
    kind = Column(String, nullable=False)  # "report_page", "image" ou "youtube"
    seconds = Column(Integer, nullable=False, default=15)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=True)
    page_name = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    video_id = Column(String, nullable=True)
    sound = Column(Boolean, nullable=False, default=False)

    tv = relationship("Tv", back_populates="items")


class TvGrant(Base):
    """Quem pode ver (e utilizar) ou modificar uma TV: uma pessoa ou um grupo, nunca os dois. "modificar" inclui "ver"."""

    __tablename__ = "tv_grants"
    __table_args__ = (
        CheckConstraint(
            "(group_id IS NOT NULL AND user_id IS NULL) OR (group_id IS NULL AND user_id IS NOT NULL)",
            name="ck_tv_grant_one_subject",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    tv_id = Column(Integer, ForeignKey("tvs.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    level = Column(String, nullable=False)  # "ver" ou "modificar"

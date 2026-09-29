"""Testes de ensure_schema_up_to_date -- garante que uma coluna nova no model e adicionada
numa tabela ja existente (simulando uma instalacao antiga atualizando pra um model novo), em
vez de quebrar com "no such column" (incidente real com reports.pbi_page_name, 2026-09-29)."""

from sqlalchemy import Column, Integer, String, create_engine, inspect, text
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import StaticPool

from app.core.schema_migrations import ensure_schema_up_to_date


def _make_engine():
    return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


def test_adiciona_coluna_faltante_em_tabela_existente():
    engine = _make_engine()
    base = declarative_base()

    class Widget(base):
        __tablename__ = "widgets"
        id = Column(Integer, primary_key=True)
        name = Column(String, nullable=False)
        extra_field = Column(String, nullable=True)

    # Simula uma instalacao "antiga": cria a tabela SEM a coluna nova (extra_field), como se o
    # banco ja existisse de antes do model ganhar esse campo.
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL)"))
        conn.execute(text("INSERT INTO widgets (id, name) VALUES (1, 'ja existia')"))

    ensure_schema_up_to_date(engine, base)

    columns = {col["name"] for col in inspect(engine).get_columns("widgets")}
    assert "extra_field" in columns

    with engine.connect() as conn:
        row = conn.execute(text("SELECT id, name, extra_field FROM widgets WHERE id = 1")).fetchone()
    assert row == (1, "ja existia", None)


def test_nao_mexe_em_tabela_ja_atualizada():
    engine = _make_engine()
    base = declarative_base()

    class Widget(base):
        __tablename__ = "widgets"
        id = Column(Integer, primary_key=True)
        name = Column(String, nullable=False)

    base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO widgets (id, name) VALUES (1, 'ja existia')"))

    # Nao deve levantar excecao nem apagar dado nenhum quando ja esta tudo em dia.
    ensure_schema_up_to_date(engine, base)

    with engine.connect() as conn:
        row = conn.execute(text("SELECT id, name FROM widgets WHERE id = 1")).fetchone()
    assert row == (1, "ja existia")


def test_cria_tabela_nova_do_zero_sem_erro():
    engine = _make_engine()
    base = declarative_base()

    class BrandNewTable(base):
        __tablename__ = "brand_new_table"
        id = Column(Integer, primary_key=True)
        name = Column(String, nullable=False)

    base.metadata.create_all(bind=engine)
    # Tabela nova (sem linhas, criada do zero) -- ensure_schema_up_to_date so pula, nao tenta
    # adicionar coluna nenhuma nela.
    ensure_schema_up_to_date(engine, base)

    columns = {col["name"] for col in inspect(engine).get_columns("brand_new_table")}
    assert columns == {"id", "name"}

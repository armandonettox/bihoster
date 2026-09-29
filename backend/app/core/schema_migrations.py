import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def ensure_schema_up_to_date(engine: Engine, base) -> None:
    """`Base.metadata.create_all()` so cria tabelas que ainda nao existem -- numa tabela ja
    existente (qualquer instalacao ja rodando), uma coluna nova no model nunca aparece sozinha
    no banco de verdade. Sem isso, adicionar uma coluna quebra a instalacao inteira com
    "no such column" assim que o backend tenta ler/escrever essa tabela (ver incidente real com
    `reports.pbi_page_name`, 2026-09-29 -- 13 relatorios da Best Saude ficaram inacessiveis ate a
    coluna ser adicionada manualmente).

    So cobre o caso simples e seguro: coluna nova NULLABLE (sem default obrigatorio). Uma coluna
    NOT NULL sem `server_default` quebraria o ALTER TABLE em SQLite numa tabela com linhas -- se
    isso for necessario um dia, adicionar a coluna nullable primeiro, popular, so depois tornar
    NOT NULL numa migracao separada.
    """
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table_name, table in base.metadata.tables.items():
            if not inspector.has_table(table_name):
                continue  # tabela nova -- create_all() ja criou com o schema completo
            existing_columns = {col["name"] for col in inspector.get_columns(table_name)}
            for column in table.columns:
                if column.name in existing_columns:
                    continue
                ddl_type = column.type.compile(dialect=engine.dialect)
                logger.warning(
                    "Migrando schema: adicionando coluna %s.%s (%s)", table_name, column.name, ddl_type
                )
                conn.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN "{column.name}" {ddl_type}'))

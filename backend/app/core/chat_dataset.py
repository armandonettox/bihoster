"""Camada de dados do chat de IA: decide se um relatorio pode ser consultado, le o esquema do
dataset, valida o DAX que a IA escreveu e executa com limites.

Regra central: relatorio com seguranca por linha (RLS) NAO e consultado. A consulta usa a Service
Principal do bihoster, e a documentacao do Power BI diz que ela nao e suportada em dataset com RLS
(e que o RLS nao vale para ela). Na duvida, bloqueia: se o Power BI nao deixa saber se ha RLS, o
relatorio fica de fora."""

import re
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core import powerbi
from app.core.powerbi import DaxQueryError, PowerBIError

MAX_ROWS_FOR_AI = 100  # linhas que a IA recebe de volta; o resto e cortado com aviso
MAX_DAX_CHARS = 8000
MAX_SCHEMA_CHARS = 12000  # tamanho do esquema em texto para o prompt
MAX_COLUMNS_PER_TABLE = 150
MAX_DESCRIPTION_CHARS = 120
ELIGIBILITY_TTL = timedelta(minutes=5)  # curto: o RLS pode ser ligado depois no Power BI
SCHEMA_TTL = timedelta(minutes=30)
QUERY_TIMEOUT_SECONDS = 45.0
QUERY_SLOT_WAIT_SECONDS = 30.0
# Poucas consultas ao mesmo tempo no processo: o Power BI limita a 120 por minuto por usuario
# (aqui, a Service Principal) e a capacidade e compartilhada com os relatorios.
_query_slots = threading.BoundedSemaphore(3)

REASON_NO_DATASET = "Este relatorio nao tem um dataset configurado, entao o chat nao consegue consultar os dados dele."
REASON_RLS = (
    "Este relatorio usa seguranca por linha (RLS), que o chat ainda nao consegue respeitar. "
    "Por seguranca, ele nao e consultado."
)
REASON_UNKNOWN = (
    "Nao foi possivel confirmar se este relatorio usa seguranca por linha (RLS). "
    "Por seguranca, o chat nao o consulta."
)
REASON_CHECK_FAILED = "Nao foi possivel verificar este relatorio no Power BI agora. Por seguranca, o chat nao o consulta."


class ChatDataError(Exception):
    """Erro com mensagem segura para mostrar ao usuario ou devolver a IA. `fixable` indica que a IA
    pode corrigir a consulta e tentar de novo (DAX invalido), ao contrario de um bloqueio."""

    def __init__(self, message: str, fixable: bool = False):
        super().__init__(message)
        self.fixable = fixable


@dataclass(frozen=True)
class Eligibility:
    ok: bool
    reason: Optional[str]


@dataclass(frozen=True)
class SchemaColumn:
    name: str
    data_type: Optional[str]
    distinct: Optional[int] = None  # quantos valores diferentes a coluna tem (so a contagem, nunca os valores)


@dataclass(frozen=True)
class SchemaTable:
    name: str
    columns: tuple[SchemaColumn, ...]
    measures: tuple[tuple[str, Optional[str]], ...]  # (nome, descricao)


@dataclass(frozen=True)
class DatasetSchema:
    tables: tuple[SchemaTable, ...]
    hidden_columns: int = 0  # colunas ocultas no modelo, que a IA nao ve (so a contagem)

    @property
    def column_count(self) -> int:
        return sum(len(t.columns) for t in self.tables)

    @property
    def measure_count(self) -> int:
        return sum(len(t.measures) for t in self.tables)


@dataclass(frozen=True)
class ChatQueryResult:
    columns: list[str]
    rows: list[dict]
    total_rows: int  # quantas linhas o Power BI devolveu
    truncated: bool  # True quando `rows` foi cortado em MAX_ROWS_FOR_AI


_eligibility_cache: dict[tuple[int, str, str], tuple[datetime, Eligibility]] = {}
_schema_cache: dict[tuple[int, str, str], tuple[datetime, DatasetSchema]] = {}


def clear_caches() -> None:
    _eligibility_cache.clear()
    _schema_cache.clear()


def _cache_key(connection, report) -> tuple[int, str, str]:
    return (connection.id, report.pbi_workspace_id, report.pbi_dataset_id)


def check_eligibility(connection, report) -> Eligibility:
    """Pode o chat consultar este relatorio? So se o dataset existe e o Power BI confirma que nao ha
    RLS. Erro ao perguntar ao Power BI bloqueia (e nao fica em cache, para tentar de novo)."""
    if not report.pbi_dataset_id:
        return Eligibility(False, REASON_NO_DATASET)

    powerbi.prune_expired(_eligibility_cache)
    key = _cache_key(connection, report)
    cached = _eligibility_cache.get(key)
    if cached:
        return cached[1]

    try:
        info = powerbi.get_dataset_security_info(connection, report.pbi_workspace_id, report.pbi_dataset_id)
    except PowerBIError:
        return Eligibility(False, REASON_CHECK_FAILED)

    if info.has_rls:
        result = Eligibility(False, REASON_RLS)
    elif not info.known:
        result = Eligibility(False, REASON_UNKNOWN)
    else:
        result = Eligibility(True, None)
    _eligibility_cache[key] = (datetime.now(timezone.utc) + ELIGIBILITY_TTL, result)
    return result


def _require_eligible(connection, report) -> None:
    """Toda leitura de dado passa por aqui, mesmo quando quem chama ja checou: assim ninguem
    esquece o bloqueio de RLS."""
    eligibility = check_eligibility(connection, report)
    if not eligibility.ok:
        raise ChatDataError(eligibility.reason or REASON_UNKNOWN)


# ---------------------------------------------------------------- esquema

# Tabelas de data que o Power BI cria sozinho: ruido para a IA
_AUTO_TABLE_PREFIXES = ("LocalDateTable_", "DateTableTemplate_")
_DATA_TYPES = {2: "texto", 6: "inteiro", 8: "decimal", 9: "data e hora", 10: "moeda", 11: "verdadeiro ou falso"}
_COLUMN_TYPE_ROW_NUMBER = 3  # coluna interna de numero de linha


def _field(row: dict, name: str):
    """O executeQueries devolve as colunas como `[Nome]` (ou, as vezes, so `Nome`)."""
    for key in (f"[{name}]", name):
        if key in row:
            return row[key]
    return None


def _is_auto_table(name: str) -> bool:
    return name.startswith(_AUTO_TABLE_PREFIXES)


def _short(text, limit: int) -> Optional[str]:
    if not isinstance(text, str):
        return None
    text = " ".join(text.split())
    if not text:
        return None
    return text if len(text) <= limit else text[: limit - 3] + "..."


def _schema_from_info(table_rows: list[dict], column_rows: list[dict], measure_rows: list[dict]) -> DatasetSchema:
    table_names: dict = {}
    for row in table_rows:
        name = _field(row, "Name")
        if not name or _field(row, "IsHidden") or _is_auto_table(name):
            continue
        table_names[_field(row, "ID")] = name

    columns: dict = {name: [] for name in table_names.values()}
    hidden_columns = 0
    for row in column_rows:
        table = table_names.get(_field(row, "TableID"))
        name = _field(row, "ExplicitName") or _field(row, "InferredName")
        if table is None or not name:
            continue
        if _field(row, "IsHidden"):
            if _field(row, "Type") != _COLUMN_TYPE_ROW_NUMBER and not name.startswith("RowNumber-"):
                hidden_columns += 1
            continue
        if _field(row, "Type") == _COLUMN_TYPE_ROW_NUMBER or name.startswith("RowNumber-"):
            continue
        type_code = _field(row, "ExplicitDataType") or _field(row, "InferredDataType")
        columns[table].append(SchemaColumn(name=name, data_type=_DATA_TYPES.get(type_code)))

    measures: dict = {name: [] for name in table_names.values()}
    for row in measure_rows:
        table = table_names.get(_field(row, "TableID"))
        name = _field(row, "Name")
        if table is None or not name or _field(row, "IsHidden"):
            continue
        measures[table].append((name, _short(_field(row, "Description"), MAX_DESCRIPTION_CHARS)))

    tables = [
        SchemaTable(name=name, columns=tuple(columns[name]), measures=tuple(measures[name]))
        for name in table_names.values()
        if columns[name] or measures[name]
    ]
    return DatasetSchema(tables=tuple(tables), hidden_columns=hidden_columns)


def _cardinalities(rows: list[dict]) -> dict[tuple[str, str], int]:
    """Quantidade de valores diferentes por coluna, vinda do COLUMNSTATISTICS(). So a coluna Cardinality e
    lida: Min e Max de uma coluna de texto seriam valores reais (nomes de pessoas) indo para o prompt."""
    result: dict[tuple[str, str], int] = {}
    for row in rows:
        table = _field(row, "Table Name")
        column = _field(row, "Column Name")
        count = _field(row, "Cardinality")
        if table and column and isinstance(count, (int, float)) and not isinstance(count, bool):
            result[(table, column)] = int(count)
    return result


def _with_cardinality(schema: DatasetSchema, cardinalities: dict[tuple[str, str], int]) -> DatasetSchema:
    if not cardinalities:
        return schema
    tables = tuple(
        SchemaTable(
            name=table.name,
            columns=tuple(
                SchemaColumn(c.name, c.data_type, cardinalities.get((table.name, c.name), c.distinct)) for c in table.columns
            ),
            measures=table.measures,
        )
        for table in schema.tables
    )
    return DatasetSchema(tables=tables, hidden_columns=schema.hidden_columns)


def _schema_from_statistics(rows: list[dict]) -> DatasetSchema:
    """Alternativa quando as funcoes INFO nao funcionam: COLUMNSTATISTICS() lista tabela e coluna.
    Nao traz medidas nem tipos, e inclui colunas ocultas; por isso so e usada como segunda opcao."""
    cardinalities = _cardinalities(rows)
    by_table: dict[str, list[SchemaColumn]] = {}
    for row in rows:
        table = _field(row, "Table Name")
        column = _field(row, "Column Name")
        if not table or not column or _is_auto_table(table) or column.startswith("RowNumber-"):
            continue
        by_table.setdefault(table, []).append(
            SchemaColumn(name=column, data_type=None, distinct=cardinalities.get((table, column)))
        )
    return DatasetSchema(
        tables=tuple(SchemaTable(name=name, columns=tuple(cols), measures=()) for name, cols in by_table.items())
    )


def _read_schema(connection, report) -> DatasetSchema:
    def run(dax: str) -> list[dict]:
        return powerbi.execute_dax_query_strict(
            connection, report.pbi_workspace_id, report.pbi_dataset_id, dax, timeout=QUERY_TIMEOUT_SECONDS
        )

    try:
        schema = _schema_from_info(run("EVALUATE INFO.TABLES()"), run("EVALUATE INFO.COLUMNS()"), run("EVALUATE INFO.MEASURES()"))
        # A contagem de valores diferentes ajuda a IA a separar uma dimensao (estado, filial) de uma coluna de
        # nomes. Se nao der para ler, o chat funciona sem ela.
        try:
            schema = _with_cardinality(schema, _cardinalities(run("EVALUATE COLUMNSTATISTICS()")))
        except (DaxQueryError, PowerBIError):
            pass
    except DaxQueryError:
        schema = _schema_from_statistics(run("EVALUATE COLUMNSTATISTICS()"))
    if not schema.tables:
        raise ChatDataError("Nao foi possivel ler tabelas e colunas visiveis deste dataset.")
    return schema


def get_dataset_schema(connection, report) -> DatasetSchema:
    """Tabelas, colunas e medidas visiveis do dataset do relatorio, com cache de SCHEMA_TTL."""
    _require_eligible(connection, report)

    powerbi.prune_expired(_schema_cache)
    key = _cache_key(connection, report)
    cached = _schema_cache.get(key)
    if cached:
        return cached[1]

    schema = _read_schema(connection, report)
    _schema_cache[key] = (datetime.now(timezone.utc) + SCHEMA_TTL, schema)
    return schema


def clear_schema_cache(connection, report) -> None:
    """Esquece o esquema guardado deste relatorio: a proxima leitura vai ao Power BI de novo (o admin
    mexeu no modelo e quer ver o resultado)."""
    _schema_cache.pop(_cache_key(connection, report), None)


def _dax_table(name: str) -> str:
    return "'" + name.replace("'", "''") + "'"


def _dax_column(table: str, column: str) -> str:
    return f"{_dax_table(table)}[{column.replace(']', ']]')}]"


def _dax_measure(name: str) -> str:
    return f"[{name.replace(']', ']]')}]"


def _column_label(table: str, column: SchemaColumn) -> str:
    """Coluna na sintaxe DAX, com o tipo e, nas de texto, quantos valores diferentes tem: e o que separa
    uma dimensao (poucos valores) de um identificador ou nome (centenas ou milhares)."""
    notes = []
    if column.data_type:
        notes.append(column.data_type)
    if column.distinct is not None and column.data_type in (None, "texto"):
        notes.append(f"{column.distinct} valores")
    return _dax_column(table, column.name) + (f" ({', '.join(notes)})" if notes else "")


@dataclass(frozen=True)
class SchemaPrompt:
    """O esquema como a IA o recebe, e o que ficou de fora por tamanho (para o admin conferir)."""

    text: str
    shown_tables: tuple[str, ...]
    omitted_tables: tuple[str, ...]  # tabelas inteiras que nao couberam
    omitted_columns: int  # colunas cortadas pelo limite por tabela, nas tabelas mostradas


MAX_OMITTED_NAMES = 20


def _blocked_keys(blocked) -> frozenset[tuple[str, str]]:
    return frozenset((table.lower(), column.lower()) for table, column in blocked)


def build_schema_prompt(schema: DatasetSchema, max_chars: int = MAX_SCHEMA_CHARS, blocked=()) -> SchemaPrompt:
    """Esquema em texto compacto, ja com a sintaxe DAX de cada nome, para a IA copiar sem errar.

    Colunas bloqueadas pelo admin nao entram. Quando passa do tamanho, a tabela que nao cabe fica de fora
    mas as seguintes, menores, ainda entram (antes uma tabela grande no meio cortava todas as demais, e a
    dimensao pequena com os valores certos sumia). As tabelas que ficaram de fora sao listadas pelo nome."""
    keys = _blocked_keys(blocked)
    blocks: list[str] = []
    shown_tables: list[str] = []
    omitted: list[str] = []
    omitted_columns = 0
    used = 0
    for table in schema.tables:
        visible = [c for c in table.columns if (table.name.lower(), c.name.lower()) not in keys]
        if not visible and not table.measures:
            continue  # so tinha colunas bloqueadas
        shown = visible[:MAX_COLUMNS_PER_TABLE]
        lines = [f"Tabela {_dax_table(table.name)}"]
        if shown:
            parts = [_column_label(table.name, c) for c in shown]
            extra = len(visible) - len(shown)
            suffix = f"; (+{extra} colunas omitidas)" if extra > 0 else ""
            lines.append("  Colunas: " + "; ".join(parts) + suffix)
        if table.measures:
            parts = [_dax_measure(n) + (f" - {d}" if d else "") for n, d in table.measures]
            lines.append("  Medidas: " + "; ".join(parts))
        block = "\n".join(lines)
        # A primeira tabela entra sempre, mesmo estourando: esquema vazio nao serve a ninguem
        if blocks and used + len(block) + 1 > max_chars:
            omitted.append(table.name)
            continue
        blocks.append(block)
        shown_tables.append(table.name)
        omitted_columns += len(visible) - len(shown)
        used += len(block) + 1
    text = "\n".join(blocks)
    if omitted:
        names = ", ".join(omitted[:MAX_OMITTED_NAMES]) + ("..." if len(omitted) > MAX_OMITTED_NAMES else "")
        text += f"\n(+{len(omitted)} tabelas omitidas por tamanho: {names})"
    return SchemaPrompt(text, tuple(shown_tables), tuple(omitted), omitted_columns)


def format_schema_for_prompt(schema: DatasetSchema, max_chars: int = MAX_SCHEMA_CHARS, blocked=()) -> str:
    return build_schema_prompt(schema, max_chars, blocked).text


# ---------------------------------------------------------------- consulta

_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_STRING = re.compile(r'"(?:[^"]|"")*"')
_LINE_COMMENT = re.compile(r"(?://|--)[^\n]*")
_QUOTED_NAME = re.compile(r"'(?:[^']|'')*'")
_BRACKET_NAME = re.compile(r"\[[^\]]*\]")


def _scrub(dax: str) -> str:
    """Tira comentarios, textos e nomes entre aspas ou colchetes, para procurar palavras-chave
    so no que e codigo."""
    for pattern in (_BLOCK_COMMENT, _STRING, _LINE_COMMENT, _QUOTED_NAME, _BRACKET_NAME):
        dax = pattern.sub(" ", dax)
    return dax


def _blocked_references(query: str, blocked, measure_names: frozenset[str]) -> list[str]:
    """Colunas bloqueadas que a consulta cita, como `Tabela[Coluna]`. Acha a forma com tabela (com ou sem
    aspas) e a forma so `[Coluna]` (valida dentro de um contexto de linha), exceto quando existe uma medida
    com esse nome: `[Nome]` sem tabela e como se chama uma medida."""
    found: list[str] = []
    for table, column in blocked:
        col = re.escape(column.replace("]", "]]"))
        tab = r"(?:'" + re.escape(table.replace("'", "''")) + r"'|" + re.escape(table) + r")"
        qualified = re.search(tab + r"\s*\[\s*" + col + r"\s*\]", query, re.IGNORECASE)
        bare = column.lower() not in measure_names and re.search(
            r"(?<![\w'\]])\[\s*" + col + r"\s*\]", query, re.IGNORECASE
        )
        if qualified or bare:
            found.append(f"{table}[{column}]")
    return found


def validate_dax(dax: str, blocked=(), measure_names: frozenset[str] = frozenset()) -> str:
    """Confere a consulta antes de mandar ao Power BI e devolve o texto sem espacos nas pontas.

    Nao e a barreira de seguranca (o executeQueries so le, nunca grava): serve para barrar erro
    cedo e manter a IA no combinado, uma consulta de dados sem olhar metadados do modelo. Com colunas
    bloqueadas pelo admin, recusa a consulta que as cita (uma camada a mais: elas ja nao aparecem no
    esquema e, se mesmo assim chegarem no resultado, sao tiradas dele)."""
    query = (dax or "").strip()
    if not query:
        raise ChatDataError("A consulta DAX esta vazia.", fixable=True)
    if len(query) > MAX_DAX_CHARS:
        raise ChatDataError(f"A consulta DAX passa de {MAX_DAX_CHARS} caracteres. Simplifique.", fixable=True)

    code = _scrub(query)
    if not re.match(r"\s*(DEFINE|EVALUATE)\b", code, re.IGNORECASE):
        raise ChatDataError("A consulta DAX deve comecar com EVALUATE (ou DEFINE).", fixable=True)
    if len(re.findall(r"\bEVALUATE\b", code, re.IGNORECASE)) != 1:
        raise ChatDataError("A consulta DAX deve ter exatamente um EVALUATE.", fixable=True)
    if re.search(r"\bINFO\s*\.|\$SYSTEM\b", code, re.IGNORECASE):
        raise ChatDataError(
            "Consultas de metadados do modelo nao sao permitidas. Use as tabelas, colunas e medidas informadas.",
            fixable=True,
        )
    if blocked:
        cited = _blocked_references(query, blocked, measure_names)
        if cited:
            raise ChatDataError(
                f"A consulta usa colunas que o administrador bloqueou para o chat: {', '.join(cited)}. "
                "Use outras colunas.",
                fixable=True,
            )
    return query


def _strip_blocked_columns(rows: list[dict], blocked) -> list[dict]:
    """Tira do resultado as colunas bloqueadas (o Power BI nomeia a coluna `Tabela[Coluna]`). Pega o caso em que a
    consulta traz a tabela inteira sem citar a coluna, como um TOPN sobre a tabela."""
    keys = {f"{table}[{column}]".lower() for table, column in blocked}
    if not rows or not any(key.lower() in keys for key in rows[0]):
        return rows
    stripped = [{k: v for k, v in row.items() if k.lower() not in keys} for row in rows]
    if not stripped[0]:
        raise ChatDataError(
            "A consulta so devolveu colunas que o administrador bloqueou para o chat. Use outras colunas.",
            fixable=True,
        )
    return stripped


def run_chat_query(connection, report, dax: str, blocked=()) -> ChatQueryResult:
    """Valida e executa a consulta DAX no dataset do relatorio, e devolve ate MAX_ROWS_FOR_AI linhas.
    `blocked` sao as colunas (tabela, coluna) que o admin bloqueou: a consulta que as cita e recusada e elas
    saem do resultado.

    Erro da consulta em si vira ChatDataError(fixable=True); falha de rede ou de autenticacao no
    Power BI propaga como PowerBIError."""
    blocked = tuple(blocked)
    measure_names: frozenset[str] = frozenset()
    if blocked:
        schema = get_dataset_schema(connection, report)  # em cache; tambem confere a elegibilidade
        measure_names = frozenset(name.lower() for table in schema.tables for name, _ in table.measures)
    query = validate_dax(dax, blocked, measure_names)
    _require_eligible(connection, report)

    if not _query_slots.acquire(timeout=QUERY_SLOT_WAIT_SECONDS):
        raise ChatDataError("Muitas consultas ao mesmo tempo. Tente novamente em instantes.")
    try:
        rows = powerbi.execute_dax_query_strict(
            connection, report.pbi_workspace_id, report.pbi_dataset_id, query, timeout=QUERY_TIMEOUT_SECONDS
        )
    except DaxQueryError as exc:
        raise ChatDataError(str(exc), fixable=True) from exc
    finally:
        _query_slots.release()

    if blocked:
        rows = _strip_blocked_columns(rows, blocked)
    total = len(rows)
    kept = rows[:MAX_ROWS_FOR_AI]
    columns = list(kept[0].keys()) if kept else []
    return ChatQueryResult(columns=columns, rows=kept, total_rows=total, truncated=total > MAX_ROWS_FOR_AI)

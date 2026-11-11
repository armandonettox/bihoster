"""Painel de Analiticos da auditoria: visuais que podem ser movidos e redimensionados.

A grade tem GRID_COLUMNS colunas; cada visual guarda x, y (posicao) e w, h (largura e altura em
celulas). `type` diz como desenhar e `source` de onde vem o numero (uma chave do resumo de
/audit/summary). O painel padrao reproduz os visuais que ja existiam.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.audit_query import GROUPS_BY_TYPE, GroupBy, Metric, QueryError, check_combination

GRID_COLUMNS = 20
MAX_WIDGETS = 40
MAX_ROW = 500

WidgetType = Literal["stat", "line", "bars", "hours", "donut", "table"]
# Cores do tema que um visual pode usar (o front troca pelas variaveis de cor)
WidgetColor = Literal["primary", "secondary", "accent", "danger", "muted"]
# "custom" = visual montado pela pessoa, com a consulta no proprio visual
CUSTOM_SOURCE = "custom"

# Quais fontes servem a cada tipo de visual
SOURCES_BY_TYPE: dict[str, set[str]] = {
    "stat": {"events", "active_users", "logins_ok", "logins_blocked", "accounts_locked", CUSTOM_SOURCE},
    "line": {"by_day", CUSTOM_SOURCE},
    "bars": {"by_action", "top_users", "top_collections", "top_reports", CUSTOM_SOURCE},
    "hours": {"by_hour"},
    "donut": {"login_methods", CUSTOM_SOURCE},
    "table": {CUSTOM_SOURCE},
}


class WidgetQuery(BaseModel):
    """O que um visual personalizado conta e como reparte."""

    metric: Metric
    group_by: GroupBy
    # Quantos itens mostrar nos agrupamentos por categoria (acao, pessoa, colecao...)
    limit: int = Field(default=8, ge=1, le=50)


class DashboardWidget(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    type: WidgetType
    source: str = Field(min_length=1, max_length=40)
    title: str | None = Field(default=None, max_length=80)
    color: WidgetColor | None = None
    query: WidgetQuery | None = None
    x: int = Field(ge=0, lt=GRID_COLUMNS)
    y: int = Field(ge=0, le=MAX_ROW)
    w: int = Field(ge=1, le=GRID_COLUMNS)
    h: int = Field(ge=1, le=40)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        return value or None

    @model_validator(mode="after")
    def check_source_and_width(self) -> "DashboardWidget":
        if self.source not in SOURCES_BY_TYPE[self.type]:
            raise ValueError(f"A fonte '{self.source}' nao serve a um visual do tipo '{self.type}'")
        if self.source == CUSTOM_SOURCE:
            if self.query is None:
                raise ValueError("Um visual personalizado precisa de medida e agrupamento")
            if self.query.group_by not in GROUPS_BY_TYPE[self.type]:
                raise ValueError(f"O agrupamento '{self.query.group_by}' nao serve a um visual do tipo '{self.type}'")
            try:
                check_combination(self.query.metric, self.query.group_by)
            except QueryError as exc:
                raise ValueError(str(exc)) from exc
        elif self.query is not None:
            raise ValueError("So um visual personalizado tem medida e agrupamento")
        if self.x + self.w > GRID_COLUMNS:
            raise ValueError("O visual passa da largura do painel")
        return self


class DashboardLayout(BaseModel):
    widgets: list[DashboardWidget] = Field(max_length=MAX_WIDGETS)

    @model_validator(mode="after")
    def ids_are_unique(self) -> "DashboardLayout":
        ids = [w.id for w in self.widgets]
        if len(ids) != len(set(ids)):
            raise ValueError("Ha visuais repetidos no painel")
        return self


def _w(id_: str, type_: str, source: str, title: str | None, x: int, y: int, w: int, h: int) -> dict:
    return {"id": id_, "type": type_, "source": source, "title": title, "x": x, "y": y, "w": w, "h": h}


def default_widgets() -> list[dict]:
    """O painel como era antes de poder ser editado: cartoes em cima e os graficos em duas colunas."""
    stats = [
        ("stat-events", "events"),
        ("stat-active-users", "active_users"),
        ("stat-logins-ok", "logins_ok"),
        ("stat-logins-blocked", "logins_blocked"),
        ("stat-accounts-locked", "accounts_locked"),
    ]
    widgets = [_w(id_, "stat", source, None, index * 4, 0, 4, 2) for index, (id_, source) in enumerate(stats)]
    widgets += [
        _w("line-by-day", "line", "by_day", "Eventos por dia", 0, 2, 20, 6),
        _w("bars-actions", "bars", "by_action", "Acoes mais frequentes", 0, 8, 10, 8),
        _w("hours-peak", "hours", "by_hour", "Horario de pico", 10, 8, 10, 8),
        _w("bars-users", "bars", "top_users", "Pessoas mais ativas", 0, 16, 10, 7),
        _w("bars-collections", "bars", "top_collections", "Colecoes mais visitadas", 10, 16, 10, 7),
        _w("bars-reports", "bars", "top_reports", "Relatorios mais visitados", 0, 23, 10, 7),
        _w("donut-logins", "donut", "login_methods", "Logins por metodo", 10, 23, 10, 7),
    ]
    return widgets

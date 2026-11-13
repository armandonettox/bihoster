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


MAX_FILTER_VALUES = 50


class WidgetFilters(BaseModel):
    """Filtros proprios de um visual. Valem junto com os da pagina: quando os dois filtram o mesmo
    campo, o visual mostra so o que esta nos dois (a conta da intersecao e feita na tela)."""

    user_id: list[int] = Field(default_factory=list, max_length=MAX_FILTER_VALUES)
    action: list[str] = Field(default_factory=list, max_length=MAX_FILTER_VALUES)
    workspace_id: list[int] = Field(default_factory=list, max_length=MAX_FILTER_VALUES)
    report_id: list[int] = Field(default_factory=list, max_length=MAX_FILTER_VALUES)
    entity: list[str] = Field(default_factory=list, max_length=MAX_FILTER_VALUES)

    @field_validator("action", "entity")
    @classmethod
    def clean_texts(cls, values: list[str]) -> list[str]:
        cleaned = [v.strip() for v in values]
        if any(not v or len(v) > 40 for v in cleaned):
            raise ValueError("Valor de filtro invalido")
        return list(dict.fromkeys(cleaned))

    @field_validator("user_id", "workspace_id", "report_id")
    @classmethod
    def clean_ids(cls, values: list[int]) -> list[int]:
        return list(dict.fromkeys(values))

    def is_empty(self) -> bool:
        return not any(getattr(self, name) for name in self.model_fields)


class WidgetQuery(BaseModel):
    """O que um visual personalizado conta e como reparte."""

    metric: Metric
    group_by: GroupBy
    # Quantos itens mostrar nos agrupamentos por categoria (acao, pessoa, colecao...)
    limit: int = Field(default=8, ge=1, le=50)
    # Filtros so deste visual; sem nenhum valor marcado fica None (igual a um visual sem filtro)
    filters: WidgetFilters | None = None

    @field_validator("filters")
    @classmethod
    def drop_empty_filters(cls, value: WidgetFilters | None) -> WidgetFilters | None:
        return None if value is None or value.is_empty() else value


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


_LAYOUT_FIELDS = {"x", "y", "w", "h"}


def required_permissions(old: list[dict], new: list[dict]) -> set[str]:
    """Permissoes que a troca de `old` por `new` exige: visual novo pede criar, visual que sumiu
    pede excluir e mudar o conteudo de um visual pede editar. Mover ou redimensionar so pede
    editar quando nada foi criado nem excluido (criar ou excluir empurra os outros visuais de lugar)."""
    from app.core.permission_keys import ANALYTICS_CREATE, ANALYTICS_DELETE, ANALYTICS_EDIT

    old_by_id = {w["id"]: w for w in old}
    new_by_id = {w["id"]: w for w in new}
    needed: set[str] = set()
    if set(new_by_id) - set(old_by_id):
        needed.add(ANALYTICS_CREATE)
    if set(old_by_id) - set(new_by_id):
        needed.add(ANALYTICS_DELETE)

    moved = False
    for id_, widget in new_by_id.items():
        before = old_by_id.get(id_)
        if before is None:
            continue
        keys = (set(widget) | set(before)) - _LAYOUT_FIELDS
        if any(widget.get(k) != before.get(k) for k in keys):
            needed.add(ANALYTICS_EDIT)
        if any(widget.get(k) != before.get(k) for k in _LAYOUT_FIELDS):
            moved = True
    if moved and not ({ANALYTICS_CREATE, ANALYTICS_DELETE} & needed):
        needed.add(ANALYTICS_EDIT)
    return needed

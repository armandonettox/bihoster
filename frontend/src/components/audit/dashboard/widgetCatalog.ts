import type { GroupBy, Metric, WidgetColor, WidgetType } from "../../../api/audit";

/** Catalogo do que a pessoa pode escolher ao montar um visual (espelha core/audit_query.py no servidor). */

export const METRIC_OPTIONS: { value: Metric; label: string }[] = [
  { value: "events", label: "Eventos" },
  { value: "people", label: "Pessoas ativas" },
  { value: "logins", label: "Logins" },
  { value: "logins_blocked", label: "Logins bloqueados" },
  { value: "accounts_locked", label: "Contas travadas" },
  { value: "report_opens", label: "Relatorios abertos" },
  { value: "collection_visits", label: "Visitas a colecoes" },
  { value: "changes", label: "Alteracoes" },
];

export const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "Total (sem agrupar)" },
  { value: "day", label: "Dia" },
  { value: "hour", label: "Hora do dia" },
  { value: "weekday", label: "Dia da semana" },
  { value: "action", label: "Acao" },
  { value: "entity", label: "Recurso" },
  { value: "user", label: "Pessoa" },
  { value: "collection", label: "Colecao" },
  { value: "report", label: "Relatorio" },
  { value: "login_method", label: "Metodo de login" },
];

export const TYPE_OPTIONS: { value: Exclude<WidgetType, "hours">; label: string; icon: string }[] = [
  { value: "stat", label: "Cartao", icon: "looks_one" },
  { value: "line", label: "Linha", icon: "show_chart" },
  { value: "bars", label: "Barras", icon: "bar_chart" },
  { value: "donut", label: "Rosca", icon: "donut_large" },
  { value: "table", label: "Tabela", icon: "table_rows" },
];

const CATEGORY_GROUPS: GroupBy[] = ["action", "entity", "user", "collection", "report", "login_method", "weekday"];

/** Agrupamentos que cada tipo de visual aceita */
export const GROUPS_BY_TYPE: Record<string, GroupBy[]> = {
  stat: ["none"],
  line: ["day", "hour", "weekday"],
  bars: ["day", "hour", "weekday", "action", "entity", "user", "collection", "report", "login_method"],
  donut: CATEGORY_GROUPS,
  table: ["day", "hour", "weekday", "action", "entity", "user", "collection", "report", "login_method"],
};

/** Agrupamentos disponiveis para um tipo e uma medida (o metodo de login so existe para Logins) */
export function groupsFor(type: WidgetType, metric: Metric): GroupBy[] {
  return (GROUPS_BY_TYPE[type] ?? []).filter((group) => group !== "login_method" || metric === "logins");
}

export const COLOR_OPTIONS: { value: WidgetColor; label: string; css: string }[] = [
  { value: "primary", label: "Azul escuro", css: "var(--color-primary-text)" },
  { value: "secondary", label: "Azul", css: "var(--color-secondary)" },
  { value: "accent", label: "Verde", css: "var(--color-accent)" },
  { value: "danger", label: "Vermelho", css: "var(--color-danger)" },
  { value: "muted", label: "Cinza", css: "var(--color-text-muted)" },
];

/** So estes tipos usam a cor escolhida (a rosca e a tabela tem as proprias cores) */
export const COLORABLE_TYPES: WidgetType[] = ["stat", "line", "bars", "hours"];

/** Tamanho de um visual recem criado, em celulas da grade */
export const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  stat: { w: 4, h: 2 },
  line: { w: 20, h: 6 },
  bars: { w: 10, h: 7 },
  donut: { w: 10, h: 7 },
  table: { w: 10, h: 8 },
};

const label = <T extends string>(options: { value: T; label: string }[], value: T) =>
  options.find((o) => o.value === value)?.label ?? value;

export const metricLabel = (metric: Metric) => label(METRIC_OPTIONS, metric);
export const groupLabel = (group: GroupBy) => label(GROUP_OPTIONS, group);

/** Titulo usado quando a pessoa nao escolhe um: "Eventos por acao", ou so a medida num cartao */
export function defaultTitle(metric: Metric, group: GroupBy): string {
  return group === "none" ? metricLabel(metric) : `${metricLabel(metric)} por ${groupLabel(group).toLowerCase()}`;
}

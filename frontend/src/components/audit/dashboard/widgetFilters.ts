import type { AuditFilters, WidgetFilters } from "../../../api/audit";

export const FILTER_KEYS = ["user_id", "action", "workspace_id", "report_id", "entity"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

// Valores que nao existem na auditoria: servem para o servidor devolver zero quando a pagina e o
// visual filtram o mesmo campo sem nenhum valor em comum (lista vazia significaria "sem filtro")
const NO_MATCH_ID = -1;
const NO_MATCH_TEXT = "__nenhum__";

/** Nenhum campo do filtro do visual tem valor marcado */
export function isEmptyWidgetFilters(filters: WidgetFilters | null | undefined): boolean {
  return !filters || FILTER_KEYS.every((key) => !filters[key]?.length);
}

/** Filtros que o visual envia ao servidor: os da pagina mais os do visual. No mesmo campo vale so o
 * que esta nos dois; sem nada em comum, o visual mostra zero. */
export function mergeFilters(page: AuditFilters, own: WidgetFilters | null | undefined): AuditFilters {
  if (isEmptyWidgetFilters(own)) return page;
  const merged: AuditFilters = { ...page };
  for (const key of FILTER_KEYS) {
    const mine = (own?.[key] ?? []) as (string | number)[];
    if (mine.length === 0) continue;
    const theirs = (page[key] ?? []) as (string | number)[];
    const values = theirs.length === 0 ? mine : mine.filter((value) => theirs.includes(value));
    const final = values.length > 0 ? values : [key === "action" || key === "entity" ? NO_MATCH_TEXT : NO_MATCH_ID];
    (merged as Record<FilterKey, (string | number)[]>)[key] = final;
  }
  return merged;
}

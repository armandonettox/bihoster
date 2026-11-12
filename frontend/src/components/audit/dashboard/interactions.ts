import type { AuditFilters, DashboardWidget, GroupBy } from "../../../api/audit";
import type { AuditFilterState } from "../../../utils/auditFilterState";

/** Mudanca nos filtros da pagina que um clique num visual pede */
export type FilterPatch = Partial<AuditFilterState>;

/** Como o visual reparte os dados: o agrupamento da consulta personalizada ou o do visual padrao */
function groupOf(widget: DashboardWidget): GroupBy | null {
  if (widget.query) return widget.query.group_by;
  switch (widget.source) {
    case "by_day":
      return "day";
    case "by_hour":
      return "hour";
    case "by_action":
      return "action";
    case "top_users":
      return "user";
    case "top_collections":
      return "collection";
    case "top_reports":
      return "report";
    case "login_methods":
      return "login_method";
    default:
      return null;
  }
}

/** Filtro que clicar num item (barra, fatia, ponto, linha) aplica. Hora, dia da semana e metodo de
 * login nao tem filtro correspondente na pagina: devolve null e o visual so mostra o rotulo. */
export function patchForKey(widget: DashboardWidget, key: string): FilterPatch | null {
  switch (groupOf(widget)) {
    case "day":
      return { period: "custom", customFrom: key, customTo: key };
    case "action":
      return { actions: [key] };
    case "entity":
      return { entities: [key] };
    case "user":
      return { userIds: [key] };
    case "collection":
      return { workspaceIds: [key] };
    case "report":
      return { reportIds: [key] };
    default:
      return null;
  }
}

/** Visual que permite clicar nos itens para filtrar */
export const isFilterable = (widget: DashboardWidget): boolean => patchForKey(widget, "x") !== null;

// Cartoes de numero que contam uma acao especifica filtram por essa acao ao clicar
const STAT_ACTIONS: Record<string, string> = {
  logins_ok: "login",
  logins: "login",
  logins_blocked: "login_blocked",
  accounts_locked: "account_locked",
  report_opens: "view_report",
  collection_visits: "view_collection",
};

/** Acao que o cartao conta, ou null quando o numero e geral (eventos, pessoas, alteracoes) */
export function statAction(widget: DashboardWidget): string | null {
  return STAT_ACTIONS[widget.query?.metric ?? widget.source] ?? null;
}

export function patchForStat(widget: DashboardWidget): FilterPatch | null {
  const action = statAction(widget);
  return action ? { actions: [action] } : null;
}

/** Itens do visual que ja estao filtrados na pagina (para destacar) */
export function selectedKeys(widget: DashboardWidget, filters: AuditFilters): string[] {
  switch (groupOf(widget)) {
    case "day":
      return filters.date_from && filters.date_from === filters.date_to ? [filters.date_from] : [];
    case "action":
      return filters.action ?? [];
    case "entity":
      return filters.entity ?? [];
    case "user":
      return (filters.user_id ?? []).map(String);
    case "collection":
      return (filters.workspace_id ?? []).map(String);
    case "report":
      return (filters.report_id ?? []).map(String);
    default:
      return [];
  }
}

/** O cartao esta destacado quando a pagina esta filtrada so pela acao que ele conta */
export function isStatSelected(widget: DashboardWidget, filters: AuditFilters): boolean {
  const action = statAction(widget);
  return action !== null && filters.action?.length === 1 && filters.action[0] === action;
}

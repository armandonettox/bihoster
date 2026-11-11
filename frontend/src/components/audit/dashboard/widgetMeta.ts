import type { DashboardWidget } from "../../../api/audit";

/** Icone, nome e destaque de cada cartao */
export const STAT_META: Record<string, { icon: string; label: string; danger?: boolean }> = {
  events: { icon: "list_alt", label: "Eventos" },
  active_users: { icon: "group", label: "Pessoas ativas" },
  logins_ok: { icon: "login", label: "Logins" },
  logins_blocked: { icon: "lock", label: "Logins bloqueados", danger: true },
  accounts_locked: { icon: "lock_clock", label: "Contas travadas", danger: true },
};

/** Titulo de cada fonte quando o visual nao tem um titulo proprio */
export const SOURCE_TITLES: Record<string, string> = {
  by_day: "Eventos por dia",
  by_action: "Acoes mais frequentes",
  by_hour: "Horario de pico",
  top_users: "Pessoas mais ativas",
  top_collections: "Colecoes mais visitadas",
  top_reports: "Relatorios mais visitados",
  login_methods: "Logins por metodo",
};

export function widgetTitle(widget: DashboardWidget): string {
  return widget.title || (widget.type === "stat" ? STAT_META[widget.source]?.label : SOURCE_TITLES[widget.source]) || widget.source;
}

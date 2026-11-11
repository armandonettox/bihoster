import { api } from "./client";

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  user_name: string | null;
  /** Email de quem agiu; continua preenchido mesmo depois de o usuario ser apagado */
  user_email: string | null;
  workspace_id: number | null;
  workspace_name: string | null;
  action: string;
  /** Nome da acao em portugues, vindo do servidor */
  action_label: string | null;
  entity: string;
  /** Tipo de recurso em portugues, vindo do servidor */
  entity_label: string | null;
  entity_id: string | null;
  details: string | null;
  created_at: string;
  /** Pode ser revertida pela auditoria: guardou o estado de antes e ainda nao foi revertida */
  revertible: boolean;
  /** O que acontece se for revertida (texto da confirmacao) */
  revert_summary: string | null;
  reverted_at: string | null;
  reverted_by_name: string | null;
}

/** Filtros comuns da tabela e dos analiticos. Datas no formato YYYY-MM-DD, no fuso do sistema. */
export interface AuditFilters {
  date_from?: string;
  date_to?: string;
  /** Cada filtro aceita varios valores (selecao multipla) */
  user_id?: number[];
  action?: string[];
  workspace_id?: number[];
  report_id?: number[];
  /** Tipo de recurso: "user", "workspace", "report"... */
  entity?: string[];
}

// O servidor espera "user_id=1&user_id=2", sem colchetes
const REPEAT_PARAMS = { indexes: null } as const;

export interface AuditPage {
  items: AuditLogEntry[];
  total: number;
  page: number;
  page_size: number;
}

/** Pessoa que aparece na auditoria, com os dados do cartao que abre ao passar o cursor no nome */
export interface AuditPerson {
  id: number;
  name: string;
  email: string;
  is_platform_admin: boolean;
  groups: string[];
  created_at: string | null;
  last_login_at: string | null;
  login_provider: "google" | "password";
  picture_url: string | null;
}

export interface AuditOptions {
  actions: { action: string; label: string }[];
  entities: { entity: string; label: string }[];
  users: AuditPerson[];
  collections: { id: number; name: string }[];
  reports: { id: number; name: string; collection: string | null }[];
}

export interface AuditSummary {
  totals: { events: number; active_users: number; logins_ok: number; logins_blocked: number; accounts_locked: number };
  by_day: { date: string; count: number }[];
  /** 24 posicoes, a hora no fuso do sistema */
  by_hour: number[];
  by_action: { action: string; label: string; count: number }[];
  top_users: { user_id: number; name: string; email: string | null; count: number }[];
  top_collections: { workspace_id: number; name: string; visits: number }[];
  top_reports: { report_id: string; name: string; collection: string | null; visits: number }[];
  login_methods: { password: number; google: number };
  timezone: string;
}

export async function searchAuditLogs(
  filters: AuditFilters,
  q: string,
  page: number,
  pageSize: number,
): Promise<AuditPage> {
  const { data } = await api.get("/audit/search", {
    params: { ...filters, q: q || undefined, page, page_size: pageSize },
    paramsSerializer: REPEAT_PARAMS,
  });
  return data;
}

export async function getAuditOptions(): Promise<AuditOptions> {
  const { data } = await api.get("/audit/options");
  return data;
}

export async function getAuditSummary(filters: AuditFilters): Promise<AuditSummary> {
  const { data } = await api.get("/audit/summary", { params: filters, paramsSerializer: REPEAT_PARAMS });
  return data;
}

/** Aviso do servidor quando a reversao nao pode seguir direto (HTTP 409) */
export interface RevertConflict {
  /** "conflict": o item mudou depois da acao; "gone": o item nao existe mais */
  code: "conflict" | "gone";
  message: string;
  /** Como o item estava logo depois da acao */
  expected?: string;
  /** Como esta agora */
  current?: string;
  /** Como ficara se a reversao seguir */
  after_revert?: string;
}

export async function revertAuditAction(id: number, force = false): Promise<{ status: string; summary: string }> {
  const { data } = await api.post(`/audit/${id}/revert`, { force });
  return data;
}

/** O aviso de conflito que veio num erro do axios, ou null se o erro for de outro tipo. */
export function revertConflictOf(err: unknown): RevertConflict | null {
  const response = (err as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  const detail = response?.data?.detail;
  if (response?.status !== 409 || typeof detail !== "object" || detail === null) return null;
  const code = (detail as { code?: string }).code;
  return code === "conflict" || code === "gone" ? (detail as RevertConflict) : null;
}

// --- Painel de Analiticos (compartilhado, editavel) ---

export type WidgetType = "stat" | "line" | "bars" | "hours" | "donut" | "table";

/** Cores do tema que um visual pode usar */
export type WidgetColor = "primary" | "secondary" | "accent" | "danger" | "muted";

export type Metric =
  | "events"
  | "people"
  | "logins"
  | "logins_blocked"
  | "accounts_locked"
  | "report_opens"
  | "collection_visits"
  | "changes";

export type GroupBy = "none" | "day" | "hour" | "weekday" | "action" | "entity" | "user" | "collection" | "report" | "login_method";

/** O que um visual personalizado conta (medida) e como reparte (agrupamento) */
export interface WidgetQuery {
  metric: Metric;
  group_by: GroupBy;
  limit: number;
}

/** Um visual do painel: o que mostrar (`type` e `source`) e onde fica na grade (x, y, w, h em celulas). */
export interface DashboardWidget {
  id: string;
  type: WidgetType;
  /** Chave do resumo de /audit/summary: "events", "by_day", "top_users"... */
  /** "custom" quando o visual foi montado pela pessoa (a consulta fica em `query`) */
  source: string;
  title: string | null;
  color: WidgetColor | null;
  query: WidgetQuery | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Dashboard {
  widgets: DashboardWidget[];
  /** Colunas da grade */
  columns: number;
  /** Ninguem salvou um layout proprio ainda: vale o padrao */
  is_default: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

export async function getDashboard(): Promise<Dashboard> {
  const { data } = await api.get("/audit/dashboard");
  return data;
}

export async function saveDashboard(widgets: DashboardWidget[]): Promise<Dashboard> {
  const { data } = await api.put("/audit/dashboard", { widgets });
  return data;
}

export async function resetDashboard(): Promise<Dashboard> {
  const { data } = await api.delete("/audit/dashboard");
  return data;
}

export interface AuditQueryResult {
  metric: Metric;
  metric_label: string;
  group_by: GroupBy;
  rows: { key: string; label: string; value: number }[];
  /** A medida no periodo todo, sem o corte do "top N" */
  total: number;
  timezone: string;
}

/** Numero ou serie de um visual personalizado, com os mesmos filtros da tabela. */
export async function queryAudit(filters: AuditFilters, query: WidgetQuery): Promise<AuditQueryResult> {
  const { data } = await api.get("/audit/query", {
    params: { ...filters, metric: query.metric, group_by: query.group_by, limit: query.limit },
    paramsSerializer: REPEAT_PARAMS,
  });
  return data;
}

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

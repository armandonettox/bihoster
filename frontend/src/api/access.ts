import { api } from "./client";

export type AccessScope = "global" | "workspace";

export interface AccessPermission {
  key: string;
  label: string;
  description: string;
  scope: AccessScope;
  section: string;
  /** Grupo de itens a que pertence: a tela mostra um interruptor que liga ou desliga todos os itens de uma vez. */
  feature: string | null;
  feature_label: string | null;
  feature_description: string | null;
  /** Outras permissões que precisam estar ligadas junto (o servidor também aplica isso). */
  requires: string[];
}

export interface AccessCatalog {
  permissions: AccessPermission[];
  presets: Record<string, string[]>;
}

/** Permissões num escopo: workspace_id nulo é o sistema todo, preenchido é uma coleção. */
export interface GrantBlock {
  workspace_id: number | null;
  permissions: string[];
}

export interface Grants {
  blocks: GrantBlock[];
  /** Falso para quem já tem tudo (grupo Administradores). */
  editable: boolean;
}

export type SubjectKind = "group" | "user";

export interface MyAccess {
  is_admin: boolean;
  global_permissions: string[];
  workspace_permissions: Record<string, string[]>;
  /** O que a pessoa recebeu direto em cada relatorio (id do relatorio para as chaves) */
  report_permissions?: Record<string, string[]>;
  /** O mesmo para modelos semanticos (id do modelo para as chaves) */
  dataset_permissions?: Record<string, string[]>;
  /** Cria TVs ou tem acesso a alguma: mostra o modulo Modo TV (o acesso de cada TV e por TV) */
  tv_access?: boolean;
}


export async function getAccessCatalog(): Promise<AccessCatalog> {
  const { data } = await api.get("/access/catalog");
  return data;
}

export async function getGrants(kind: SubjectKind, id: number): Promise<Grants> {
  const { data } = await api.get(`/access/${kind}s/${id}`);
  return data;
}

export async function setGrants(kind: SubjectKind, id: number, blocks: GrantBlock[]): Promise<Grants> {
  const { data } = await api.put(`/access/${kind}s/${id}`, { blocks });
  return data;
}

export async function getMyAccess(): Promise<MyAccess> {
  const { data } = await api.get("/access/me");
  return data;
}

export interface ReportPermission {
  key: string;
  label: string;
  /** Grupos de onde a permissão vem. */
  groups: string[];
  /** Também foi dada direto à pessoa. */
  direct: boolean;
}

export interface ReportGroup {
  name: string;
  is_default: boolean;
}

export interface ReportRow {
  user_id: number;
  name: string;
  email: string;
  is_admin: boolean;
  groups: ReportGroup[];
  workspace_id: number | null;
  scope_label: string;
  permissions: ReportPermission[];
}

export interface ReportFilters {
  search?: string;
  user_id?: number;
  group_id?: number;
  /** "global" ou o id de uma coleção. */
  scope?: string;
  permission?: string;
  only_direct?: boolean;
}

export interface GroupGrants {
  group_id: number;
  blocks: GrantBlock[];
  /** Falso no grupo Administradores, que tem todas as permissões sempre. */
  editable: boolean;
}

/** As permissões de todos os grupos de uma vez (a visão por grupo da aba Membros e permissões). */
export async function listGroupsGrants(): Promise<GroupGrants[]> {
  const { data } = await api.get("/access/groups");
  return data.groups;
}

/** Soma permissões avulsas a uma pessoa pelo e-mail: aplica na hora se ela tem conta, ou reserva no convite. */
export async function grantByEmail(email: string, blocks: GrantBlock[]): Promise<{ status: "applied" | "pending" }> {
  const { data } = await api.post("/access/by-email", { email, blocks });
  return data;
}

export async function getAccessReport(filters: ReportFilters): Promise<ReportRow[]> {
  const params: Record<string, string | number | boolean> = {};
  if (filters.search?.trim()) params.search = filters.search.trim();
  if (filters.user_id !== undefined) params.user_id = filters.user_id;
  if (filters.group_id !== undefined) params.group_id = filters.group_id;
  if (filters.scope) params.scope = filters.scope;
  if (filters.permission) params.permission = filters.permission;
  if (filters.only_direct) params.only_direct = true;
  const { data } = await api.get("/access/report", { params });
  return data.rows;
}

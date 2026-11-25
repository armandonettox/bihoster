import { api } from "./client";

export interface ReportPermissionItem {
  key: string;
  label: string;
  description: string;
  feature: string | null;
  feature_label: string | null;
  requires: string[];
}

export interface ReportCatalog {
  permissions: ReportPermissionItem[];
  /** Atalhos que so preenchem as caixas (nome para as chaves) */
  presets: Record<string, string[]>;
}

export interface ReportRef {
  id: number;
  name: string;
  collection_id: number;
  collection_name: string;
  in_root: boolean;
}

export interface MatrixCell {
  /** O que foi dado direto no relatorio ao grupo */
  direct: string[];
  /** O que o grupo recebe pela colecao do relatorio */
  inherited: string[];
}

export interface MatrixRow {
  report: ReportRef;
  /** Id do grupo (como texto, e assim que o JSON chega) para a celula */
  cells: Record<string, MatrixCell>;
}

export interface MatrixGroup {
  id: number;
  name: string;
}

export interface Matrix {
  groups: MatrixGroup[];
  rows: MatrixRow[];
  total: number;
  page: number;
  page_size: number;
}

export type MatrixWhere = "all" | "root" | "collections";

export interface PersonRow {
  report: ReportRef;
  permissions: string[];
  sources: string[];
}

export interface Person {
  user_id: number;
  name: string;
  is_admin: boolean;
  rows: PersonRow[];
  /** Paginado no servidor, sem limite fixo */
  total: number;
  page: number;
  page_size: number;
  truncated?: boolean;
}

export interface BulkInput {
  report_ids: number[];
  group_ids: number[];
  user_ids: number[];
  permissions: string[];
  mode: "add" | "remove";
}

export interface SharedReport {
  id: number;
  name: string;
  collection_id: number;
  collection_name: string;
  in_root: boolean;
  thumbnail_url: string | null;
  display_type: string;
}

export async function getReportCatalog(): Promise<ReportCatalog> {
  const { data } = await api.get("/report-access/catalog");
  return data;
}

export async function getMatrix(params: { search?: string; where?: MatrixWhere; page?: number; pageSize?: number }): Promise<Matrix> {
  const { data } = await api.get("/report-access/matrix", {
    params: {
      search: params.search || undefined,
      where: params.where && params.where !== "all" ? params.where : undefined,
      page: params.page ?? 1,
      page_size: params.pageSize ?? 25,
    },
  });
  return data;
}

export async function getPerson(userId: number, params: { page?: number; pageSize?: number; search?: string } = {}): Promise<Person> {
  const { data } = await api.get(`/report-access/person/${userId}`, {
    params: { page: params.page ?? 1, page_size: params.pageSize ?? 25, search: params.search || undefined },
  });
  return data;
}

export async function bulkChange(input: BulkInput): Promise<{ reports: number; subjects: number; changes: number }> {
  const { data } = await api.post("/report-access/bulk", input);
  return data;
}

export async function listSharedWithMe(): Promise<SharedReport[]> {
  const { data } = await api.get("/report-access/shared-with-me");
  return data;
}

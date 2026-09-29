import { api } from "./client";

export type DisplayType = "relatorio" | "painel" | "apresentacao" | "tv";

export interface Report {
  id: number;
  collection_id: number;
  name: string;
  powerbi_connection_id: number | null;
  pbi_workspace_id: string;
  pbi_report_id: string;
  pbi_dataset_id: string | null;
  pbi_page_name: string | null;
  display_type: DisplayType;
}

export interface ReportInput {
  name: string;
  powerbi_connection_id: number;
  pbi_workspace_id: string;
  pbi_report_id: string;
  pbi_dataset_id?: string | null;
  pbi_page_name?: string | null;
  display_type?: DisplayType;
}

export async function listReports(workspaceId: number): Promise<Report[]> {
  const { data } = await api.get(`/workspaces/${workspaceId}/reports/`);
  return data;
}

export async function createReport(workspaceId: number, input: ReportInput): Promise<Report> {
  const { data } = await api.post(`/workspaces/${workspaceId}/reports/`, input);
  return data;
}

export async function updateReport(workspaceId: number, id: number, input: Partial<ReportInput>): Promise<Report> {
  const { data } = await api.put(`/workspaces/${workspaceId}/reports/${id}`, input);
  return data;
}

export async function deleteReport(workspaceId: number, id: number): Promise<void> {
  await api.delete(`/workspaces/${workspaceId}/reports/${id}`);
}

export interface EmbedConfig {
  report_id: string;
  embed_url: string;
  access_token: string;
  page_name: string | null;
  /** Quando o embed token expira (ISO UTC com Z); null se o backend for de uma versao antiga */
  expires_at?: string | null;
}

export async function getEmbedConfig(workspaceId: number, reportId: number): Promise<EmbedConfig> {
  const { data } = await api.get(`/workspaces/${workspaceId}/powerbi/reports/${reportId}/embed`);
  return data;
}

export interface RefreshInfo {
  last_refresh: string | null;
  next_refresh: string | null;
}

export async function getRefreshInfo(workspaceId: number, reportId: number): Promise<RefreshInfo> {
  const { data } = await api.get(`/workspaces/${workspaceId}/powerbi/reports/${reportId}/refresh-info`);
  return data;
}

/** Sobe ou desce um relatorio dentro da propria secao. Devolve a lista da colecao ja reordenada. */
export async function moveReport(
  workspaceId: number,
  reportId: number,
  direction: "up" | "down",
): Promise<Report[]> {
  const { data } = await api.post(`/workspaces/${workspaceId}/reports/${reportId}/move`, { direction });
  return data;
}

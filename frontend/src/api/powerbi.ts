import { api } from "./client";

export interface PowerBIWorkspace {
  id: string;
  name: string;
}

export interface PowerBIReportSummary {
  id: string;
  name: string;
  dataset_id: string | null;
}

export interface PowerBIPage {
  name: string;
  display_name: string;
}

export async function listPowerBIWorkspaces(connectionId: number): Promise<PowerBIWorkspace[]> {
  const { data } = await api.get(`/powerbi/connections/${connectionId}/workspaces`);
  return data;
}

export async function listPowerBIReports(connectionId: number, pbiWorkspaceId: string): Promise<PowerBIReportSummary[]> {
  const { data } = await api.get(`/powerbi/connections/${connectionId}/workspaces/${pbiWorkspaceId}/reports`);
  return data;
}

export async function listPowerBIPages(
  connectionId: number,
  pbiWorkspaceId: string,
  pbiReportId: string
): Promise<PowerBIPage[]> {
  const { data } = await api.get(
    `/powerbi/connections/${connectionId}/workspaces/${pbiWorkspaceId}/reports/${pbiReportId}/pages`
  );
  return data;
}

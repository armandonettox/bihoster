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

export async function listPowerBIWorkspaces(connectionId: number): Promise<PowerBIWorkspace[]> {
  const { data } = await api.get(`/powerbi/connections/${connectionId}/workspaces`);
  return data;
}

export async function listPowerBIReports(connectionId: number, pbiWorkspaceId: string): Promise<PowerBIReportSummary[]> {
  const { data } = await api.get(`/powerbi/connections/${connectionId}/workspaces/${pbiWorkspaceId}/reports`);
  return data;
}

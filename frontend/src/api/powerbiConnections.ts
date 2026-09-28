import { api } from "./client";

export interface PowerBIConnection {
  id: number;
  name: string;
  tenant_id: string;
  client_id: string;
  client_secret_configured: boolean;
}

export interface PowerBIConnectionInput {
  name: string;
  tenant_id: string;
  client_id: string;
  client_secret?: string;
}

export async function listConnections(): Promise<PowerBIConnection[]> {
  const { data } = await api.get("/powerbi-connections/");
  return data;
}

export async function createConnection(input: PowerBIConnectionInput): Promise<PowerBIConnection> {
  const { data } = await api.post("/powerbi-connections/", input);
  return data;
}

export async function updateConnection(id: number, input: Partial<PowerBIConnectionInput>): Promise<PowerBIConnection> {
  const { data } = await api.put(`/powerbi-connections/${id}`, input);
  return data;
}

export async function deleteConnection(id: number): Promise<void> {
  await api.delete(`/powerbi-connections/${id}`);
}

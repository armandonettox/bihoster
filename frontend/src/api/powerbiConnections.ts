import { api } from "./client";

export interface PowerBIConnection {
  id: number;
  name: string;
  tenant_id: string;
  client_id: string;
  client_secret_configured: boolean;
  /** Sincronizacao automatica do catalogo: de quantas em quantas horas (nulo = so pelo botao, o padrao) */
  sync_interval_hours?: number | null;
  last_sync_at?: string | null;
  /** Nulo se desligada ou se ainda nao houve rodada */
  next_sync_at?: string | null;
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

export interface SyncRecord {
  id: number;
  started_at: string | null;
  finished_at: string | null;
  /** Verdadeiro quando a rodada foi da rotina agendada, e nao de uma pessoa clicando no botao */
  started_by_scheduler: boolean;
  reports_new: number | null;
  reports_updated: number | null;
  reports_missing: number | null;
  datasets_new: number | null;
  datasets_updated: number | null;
  datasets_missing: number | null;
  error: string | null;
}

export interface SyncStatus {
  last_sync: SyncRecord | null;
  /** Vazio = todos os workspaces do tenant */
  workspace_ids: string[];
  /** Nulo = so pelo botao */
  interval_hours: number | null;
  next_run_at?: string | null;
  running_job_id: string | null;
}

export interface SyncJobStatus {
  /** queued, running, done ou error */
  status: string;
  message: string;
  progress: number;
  sync_id: number | null;
}

export interface TenantWorkspace {
  id: string;
  name: string;
}

/** Pede a sincronizacao do catalogo da conta, em segundo plano. Devolve o id do trabalho. */
export async function startSync(connectionId: number): Promise<string> {
  const { data } = await api.post(`/powerbi-connections/${connectionId}/sync`);
  return data.job_id;
}

export async function getSyncJob(connectionId: number, jobId: string): Promise<SyncJobStatus> {
  const { data } = await api.get(`/powerbi-connections/${connectionId}/sync-jobs/${jobId}`);
  return data;
}

export async function getSyncStatus(connectionId: number): Promise<SyncStatus> {
  const { data } = await api.get(`/powerbi-connections/${connectionId}/sync-status`);
  return data;
}

export async function updateSyncSettings(
  connectionId: number,
  settings: { workspace_ids: string[]; interval_hours: number | null },
): Promise<SyncStatus> {
  const { data } = await api.put(`/powerbi-connections/${connectionId}/sync-settings`, settings);
  return data;
}

export async function listTenantWorkspaces(connectionId: number): Promise<TenantWorkspace[]> {
  const { data } = await api.get(`/powerbi-connections/${connectionId}/tenant-workspaces`);
  return data;
}

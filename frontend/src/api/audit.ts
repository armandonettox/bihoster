import { api } from "./client";

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  user_name: string | null;
  workspace_id: number | null;
  workspace_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: string | null;
  created_at: string;
}

export async function listAuditLogs(limit = 200): Promise<AuditLogEntry[]> {
  const { data } = await api.get("/audit", { params: { limit } });
  return data;
}

import { api } from "./client";

export const ALERT_CONDITIONS = [">", "<", ">=", "<=", "=", "!="] as const;
export type AlertCondition = (typeof ALERT_CONDITIONS)[number];

export const CONDITION_LABELS: Record<AlertCondition, string> = {
  ">": "maior que",
  "<": "menor que",
  ">=": "maior ou igual a",
  "<=": "menor ou igual a",
  "=": "igual a",
  "!=": "diferente de",
};

export interface Measure {
  measure_name: string;
  table_name: string;
}

export interface Alert {
  id: number;
  report_id: number;
  report_name: string;
  collection_id: number;
  collection_name: string | null;
  created_by_name: string | null;
  name: string | null;
  measure_name: string;
  table_name: string | null;
  condition: AlertCondition;
  threshold: number;
  recipients: string[];
  subject: string | null;
  message: string | null;
  check_interval_minutes: number;
  cooldown_hours: number;
  enabled: boolean;
  last_checked_at: string | null;
  last_triggered_at: string | null;
  last_value: number | null;
  last_status: string | null;
  last_message: string | null;
  created_at: string | null;
}

export interface AlertInput {
  name?: string | null;
  measure_name: string;
  table_name?: string | null;
  condition: AlertCondition;
  threshold: number;
  recipients: string[];
  subject?: string | null;
  message?: string | null;
  check_interval_minutes?: number;
  cooldown_hours?: number;
  enabled?: boolean;
}

export async function listReportMeasures(workspaceId: number, reportId: number): Promise<Measure[]> {
  const { data } = await api.get(`/workspaces/${workspaceId}/reports/${reportId}/measures`);
  return data;
}

export async function listReportAlerts(workspaceId: number, reportId: number): Promise<Alert[]> {
  const { data } = await api.get(`/workspaces/${workspaceId}/reports/${reportId}/alerts`);
  return data;
}

export async function createAlert(workspaceId: number, reportId: number, input: AlertInput): Promise<Alert> {
  const { data } = await api.post(`/workspaces/${workspaceId}/reports/${reportId}/alerts`, input);
  return data;
}

export async function updateAlert(workspaceId: number, alertId: number, input: Partial<AlertInput>): Promise<Alert> {
  const { data } = await api.put(`/workspaces/${workspaceId}/alerts/${alertId}`, input);
  return data;
}

export async function deleteAlert(workspaceId: number, alertId: number): Promise<void> {
  await api.delete(`/workspaces/${workspaceId}/alerts/${alertId}`);
}

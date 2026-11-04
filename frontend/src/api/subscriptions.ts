import { api } from "./client";

export type SubscriptionFormat = "PDF" | "PNG";

export interface Subscription {
  id: number;
  report_id: number;
  report_name: string;
  collection_id: number;
  collection_name: string | null;
  name: string | null;
  recipients: string[];
  format: SubscriptionFormat;
  /** 0 = segunda ... 6 = domingo */
  days: number[];
  times: string[];
  schedule_text: string;
  timezone: string;
  start_date: string | null;
  end_date: string | null;
  subject: string | null;
  message: string | null;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_message: string | null;
  consecutive_failures: number;
  created_by_name: string | null;
  created_at: string | null;
}

export interface SubscriptionInput {
  name?: string | null;
  recipients: string[];
  format: SubscriptionFormat;
  days: number[];
  times: string[];
  timezone?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  subject?: string | null;
  message?: string | null;
  enabled?: boolean;
}

export interface SubscriptionRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  /** ok, error ou skipped */
  status: string;
  /** schedule ou manual */
  trigger: string;
  attempts: number;
  message: string | null;
  recipients_count: number;
}

export async function listReportSubscriptions(workspaceId: number, reportId: number): Promise<Subscription[]> {
  const { data } = await api.get(`/workspaces/${workspaceId}/reports/${reportId}/subscriptions`);
  return data;
}

export async function createSubscription(
  workspaceId: number,
  reportId: number,
  input: SubscriptionInput,
): Promise<Subscription> {
  const { data } = await api.post(`/workspaces/${workspaceId}/reports/${reportId}/subscriptions`, input);
  return data;
}

export async function updateSubscription(
  workspaceId: number,
  subscriptionId: number,
  input: Partial<SubscriptionInput>,
): Promise<Subscription> {
  const { data } = await api.put(`/workspaces/${workspaceId}/subscriptions/${subscriptionId}`, input);
  return data;
}

export async function deleteSubscription(workspaceId: number, subscriptionId: number): Promise<void> {
  await api.delete(`/workspaces/${workspaceId}/subscriptions/${subscriptionId}`);
}

/** Dispara o envio agora, em segundo plano. Devolve o id do trabalho (andamento em reportDelivery). */
export async function runSubscriptionNow(workspaceId: number, subscriptionId: number): Promise<string> {
  const { data } = await api.post(`/workspaces/${workspaceId}/subscriptions/${subscriptionId}/run`);
  return data.job_id;
}

export async function listSubscriptionRuns(workspaceId: number, subscriptionId: number): Promise<SubscriptionRun[]> {
  const { data } = await api.get(`/workspaces/${workspaceId}/subscriptions/${subscriptionId}/runs`);
  return data;
}

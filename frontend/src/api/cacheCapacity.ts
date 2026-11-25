import { api } from "./client";

export interface OpeningsReport {
  report_id: number;
  report_name: string;
  total: number;
  /** Aberturas por hora: chave "AAAA-MM-DDTHH" (UTC) */
  by_hour: Record<string, number>;
}

export interface Openings {
  hours: number;
  reports: OpeningsReport[];
}

export interface CapacityRange {
  days: number[];
  start: string;
  end: string;
}

export interface CapacityConnection {
  connection_id: number;
  name: string;
  azure_subscription_id: string | null;
  azure_resource_group: string | null;
  azure_capacity_name: string | null;
  configured: boolean;
  /** Modo simulado (o padrao): so registra o que faria, sem falar com o Azure */
  simulated: boolean;
  capacity_schedule_enabled: boolean;
  schedule: CapacityRange[];
  state: "running" | "paused" | null;
  state_at: string | null;
}

export interface CapacityOverview {
  master_switch: boolean;
  connections: CapacityConnection[];
}

export interface CapacityConfigInput {
  azure_subscription_id: string | null;
  azure_resource_group: string | null;
  azure_capacity_name: string | null;
  /** true = chamar o Azure de verdade; qualquer outra coisa = simulado */
  capacity_real_calls: boolean | null;
  capacity_schedule_enabled: boolean;
  schedule: CapacityRange[];
}

export async function getOpenings(hours = 24): Promise<Openings> {
  const { data } = await api.get("/cache-capacity/openings", { params: { hours } });
  return data;
}

export async function getCapacity(): Promise<CapacityOverview> {
  const { data } = await api.get("/cache-capacity/connections");
  return data;
}

export async function saveCapacity(connectionId: number, input: CapacityConfigInput): Promise<CapacityConnection> {
  const { data } = await api.put(`/cache-capacity/connections/${connectionId}`, input);
  return data;
}

export async function capacityAction(connectionId: number, action: "suspend" | "resume"): Promise<CapacityConnection & { mode: "simulated" | "real" }> {
  const { data } = await api.post(`/cache-capacity/connections/${connectionId}/${action}`);
  return data;
}

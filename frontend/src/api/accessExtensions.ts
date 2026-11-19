import { api } from "./client";

export type ExtensionStatus = "pending" | "approved" | "denied" | "revoked";

/** Um pedido de mais tempo de acesso. `active` diz se a liberação aprovada ainda está valendo agora. */
export interface ExtensionRequest {
  id: number;
  user_id: number;
  user_name: string | null;
  user_email: string | null;
  reason: string;
  status: ExtensionStatus;
  created_at: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  note: string | null;
  grant_until: string | null;
  active: boolean;
}

/** O pedido mais recente da própria pessoa (funciona fora do horário, é a tela de aviso que pergunta). */
export async function getMyRequest(): Promise<ExtensionRequest | null> {
  const { data } = await api.get("/access-extensions/mine");
  return data.request;
}

export async function requestMoreTime(reason: string): Promise<ExtensionRequest> {
  const { data } = await api.post("/access-extensions/mine", { reason });
  return data;
}

/** Para quem pode liberar: os pedidos abertos e os decididos nos últimos dias. */
export async function listExtensionRequests(): Promise<ExtensionRequest[]> {
  const { data } = await api.get("/access-extensions/");
  return data;
}

/** Duração em minutos, ou um horário do dia ("HH:MM", no fuso do sistema): um dos dois. */
export interface ApproveInput {
  minutes?: number;
  until_time?: string;
}

export async function approveRequest(id: number, input: ApproveInput): Promise<ExtensionRequest> {
  const { data } = await api.post(`/access-extensions/${id}/approve`, input);
  return data;
}

export async function denyRequest(id: number, note?: string): Promise<ExtensionRequest> {
  const { data } = await api.post(`/access-extensions/${id}/deny`, { note: note || null });
  return data;
}

export async function revokeRelease(id: number): Promise<ExtensionRequest> {
  const { data } = await api.post(`/access-extensions/${id}/revoke`);
  return data;
}

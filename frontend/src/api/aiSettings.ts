import { api } from "./client";

/** Um provedor de IA. A chave nunca vem: so se ja foi cadastrada. */
export interface AIProvider {
  provider: string;
  label: string;
  /** Sugestao para o campo de modelo; o modelo de verdade e escolhido pelo admin */
  example_model: string;
  api_key_configured: boolean;
  model: string | null;
  enabled: boolean;
  /** Provedor que responde o chat. Um so por vez, e so entre os ativos. */
  chat_default: boolean;
}

/** `api_key`: ausente = manter a atual; texto vazio = apagar; outro texto = trocar. */
export interface AIProviderUpdate {
  api_key?: string;
  model?: string | null;
  enabled?: boolean;
  chat_default?: boolean;
}

export interface AIProviderTest {
  ok: boolean;
  model: string;
  latency_ms: number;
}

/** O que a pessoa logada pode fazer com a IA. Quem manda de verdade e o servidor, em cada rota. */
export interface AIAccess {
  can_manage: boolean;
  can_use: boolean;
}

export async function getAIAccess(): Promise<AIAccess> {
  const { data } = await api.get("/ai/access");
  return data;
}

export async function listAIProviders(): Promise<AIProvider[]> {
  const { data } = await api.get("/settings/ai/");
  return data;
}

export async function updateAIProvider(provider: string, input: AIProviderUpdate): Promise<AIProvider> {
  const { data } = await api.put(`/settings/ai/${provider}`, input);
  return data;
}

export async function testAIProvider(provider: string): Promise<AIProviderTest> {
  const { data } = await api.post(`/settings/ai/${provider}/test`);
  return data;
}

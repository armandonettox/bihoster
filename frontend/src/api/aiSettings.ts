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

/** Opcoes do chat que o admin ajusta: historico, limite de perguntas e orcamento do OpenRouter. */
export interface AIOptions {
  retention_days: number;
  default_retention_days: number;
  /** Perguntas por pessoa por dia; 0 = sem limite */
  daily_question_limit: number;
  default_daily_question_limit: number;
  /** Dolares por mes so do OpenRouter; null = sem orcamento */
  openrouter_monthly_budget_usd: number | null;
}

/** Campo ausente = manter o valor atual. Orcamento 0 tira o orcamento. */
export interface AIOptionsUpdate {
  retention_days?: number;
  daily_question_limit?: number;
  openrouter_monthly_budget_usd?: number;
}

export async function getAIOptions(): Promise<AIOptions> {
  const { data } = await api.get("/ai/options/");
  return data;
}

export async function updateAIOptions(input: AIOptionsUpdate): Promise<AIOptions> {
  const { data } = await api.put("/ai/options/", input);
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

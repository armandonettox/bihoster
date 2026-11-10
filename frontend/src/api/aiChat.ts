import { api } from "./client";

export interface ChatReport {
  id: number;
  name: string;
}

/** Resultado da consulta. So vem na resposta recebida agora: o historico nao guarda as linhas. */
export interface ChatTable {
  columns: string[];
  rows: Record<string, unknown>[];
  total_rows: number;
  truncated: boolean;
}

export interface ChatUsage {
  provider: string;
  model: string;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

export interface ChatResponse {
  conversation_id: number;
  conversation_title: string;
  reply: string;
  report: ChatReport | null;
  dax: string | null;
  table: ChatTable | null;
  usage: ChatUsage;
}

export interface Conversation {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatHistoryMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  report: ChatReport | null;
  dax: string | null;
  created_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: ChatHistoryMessage[];
}

/** Sem `conversationId` comeca uma conversa nova; com ele, continua uma conversa da propria pessoa. */
export async function sendChatMessage(message: string, conversationId?: number): Promise<ChatResponse> {
  const { data } = await api.post("/ai/chat", {
    message,
    ...(conversationId !== undefined ? { conversation_id: conversationId } : {}),
  });
  return data;
}

export async function listConversations(): Promise<Conversation[]> {
  const { data } = await api.get("/ai/conversations/");
  return data;
}

export async function getConversation(id: number): Promise<ConversationDetail> {
  const { data } = await api.get(`/ai/conversations/${id}`);
  return data;
}

export async function deleteConversation(id: number): Promise<void> {
  await api.delete(`/ai/conversations/${id}`);
}

export async function deleteAllConversations(): Promise<void> {
  await api.delete("/ai/conversations/");
}

export interface UsageTotals {
  questions: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  unpriced_questions: number;
}

export interface UsageByUser extends UsageTotals {
  user_id: number | null;
  email: string | null;
}

export interface UsageByModel extends UsageTotals {
  provider: string;
  model: string;
}

export interface OpenRouterBudget {
  monthly_usd: number | null;
  spent_month_usd: number;
  remaining_usd: number | null;
  blocked: boolean;
  unpriced_questions_month: number;
}

export interface AIUsageSummary {
  period_days: number;
  totals: UsageTotals;
  by_user: UsageByUser[];
  by_model: UsageByModel[];
  daily_limit: number;
  openrouter_budget: OpenRouterBudget;
}

export async function getAIUsage(days: number): Promise<AIUsageSummary> {
  const { data } = await api.get("/ai/usage/", { params: { days } });
  return data;
}

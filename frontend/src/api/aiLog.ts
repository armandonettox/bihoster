import { api } from "./client";

/** Um passo da pergunta: chamada a IA, leitura do esquema ou consulta ao Power BI. Nunca traz texto nem dados. */
export interface AILogStep {
  step: string;
  ms?: number;
  max_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  finish_reason?: string;
  text_chars?: number;
  json_ok?: boolean;
  rows?: number;
  error?: string;
}

export interface AILogEntry {
  id: number;
  created_at: string;
  user_email: string | null;
  conversation_id: number | null;
  provider: string;
  model: string;
  report_name: string | null;
  outcome: string;
  error: string | null;
  duration_ms: number;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  used_image: boolean;
  question: string | null;
  reply: string | null;
  dax: string | null;
  steps: AILogStep[];
}

export interface AILogModelStats {
  provider: string;
  model: string;
  questions: number;
  problems: number;
  avg_ms: number;
  p95_ms: number;
}

export interface AILog {
  days: number;
  retention_days: number;
  entries: AILogEntry[];
  next_before_id: number | null;
  by_model: AILogModelStats[];
}

export interface AILogQuery {
  days: number;
  onlyProblems: boolean;
  beforeId?: number;
}

export async function getAILog({ days, onlyProblems, beforeId }: AILogQuery): Promise<AILog> {
  const { data } = await api.get("/ai/log/", {
    params: { days, only_problems: onlyProblems, ...(beforeId !== undefined ? { before_id: beforeId } : {}) },
  });
  return data;
}

import { api } from "./client";

/** Coluna que a IA nunca consulta neste relatorio */
export interface BlockedColumn {
  table: string;
  column: string;
}

export interface AIReportSettings {
  report_id: number;
  report_name: string;
  /** Orientacoes escritas pelo admin: o que os dados significam */
  notes: string;
  blocked_columns: BlockedColumn[];
  /** A IA pode receber a imagem da pagina aberta do relatorio (desligado por padrao) */
  allow_images: boolean;
}

export interface AIReportSettingsInput {
  notes: string;
  blocked_columns: BlockedColumn[];
  allow_images: boolean;
}

export interface AISchemaColumn {
  name: string;
  data_type: string | null;
  /** Quantidade de valores diferentes (so colunas de texto; nunca os valores) */
  distinct: number | null;
  blocked: boolean;
}

export interface AISchemaTable {
  name: string;
  columns: AISchemaColumn[];
  measures: string[];
  /** Falso quando a tabela nao coube no esquema enviado a IA */
  in_prompt: boolean;
}

/** O que a IA enxerga de um relatorio: so nomes e contagens, nunca linhas de dados */
export interface AIReportSchema {
  report_id: number;
  report_name: string;
  eligible: boolean;
  reason: string | null;
  tables: AISchemaTable[] | null;
  prompt_chars: number;
  prompt_max_chars: number;
  omitted_tables: string[];
  omitted_columns: number;
  hidden_columns: number;
}

export async function getReportSchema(reportId: number, refresh = false): Promise<AIReportSchema> {
  const { data } = await api.get(`/ai/reports/${reportId}/schema`, { params: { refresh } });
  return data;
}

export async function getReportSettings(reportId: number): Promise<AIReportSettings> {
  const { data } = await api.get(`/ai/reports/${reportId}/settings`);
  return data;
}

export async function saveReportSettings(reportId: number, input: AIReportSettingsInput): Promise<AIReportSettings> {
  const { data } = await api.put(`/ai/reports/${reportId}/settings`, input);
  return data;
}

/** ready: a imagem ja pode ser usada; warming: sendo gerada; disabled: o admin nao liberou imagens */
export type PageImageState = "ready" | "warming" | "disabled";

/** Pede a imagem da pagina aberta. Nao espera a exportacao: ela roda no servidor, em segundo plano. */
export async function warmPageImage(reportId: number, pageName: string): Promise<PageImageState> {
  const { data } = await api.post(`/ai/reports/${reportId}/page-image`, { page_name: pageName });
  return data.state;
}

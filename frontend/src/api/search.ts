import { api } from "./client";
import type { DisplayType } from "./reports";

export interface SearchResultEntry {
  /** Id do relatorio; para kind "colecao" e o id da propria colecao (igual a workspace_id) */
  id: number;
  name: string;
  /** Ausente em backend de versao antiga: tratar como relatorio */
  kind?: "relatorio" | "colecao";
  /** Vazio para colecoes */
  display_type: DisplayType | null;
  workspace_id: number;
  workspace_name: string;
  workspace_slug: string;
}

export async function searchReports(query: string): Promise<SearchResultEntry[]> {
  const { data } = await api.get("/search/", { params: { q: query } });
  return data;
}

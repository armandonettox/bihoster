import { api } from "./client";
import type { DisplayType } from "./reports";

export interface SearchResultEntry {
  id: number;
  name: string;
  display_type: DisplayType;
  workspace_id: number;
  workspace_name: string;
  workspace_slug: string;
}

export async function searchReports(query: string): Promise<SearchResultEntry[]> {
  const { data } = await api.get("/search/", { params: { q: query } });
  return data;
}

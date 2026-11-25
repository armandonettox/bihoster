import { api } from "./client";

export interface CatalogReport {
  id: number;
  name: string;
  connection_id: number | null;
  connection_name: string | null;
  pbi_workspace_id: string;
  pbi_workspace_name: string | null;
  pbi_report_id: string;
  pbi_dataset_id: string | null;
  /** "sync" = veio do Power BI; nulo = cadastrado a mao */
  source: string | null;
  in_root: boolean;
  collection_id: number;
  collection_name: string;
  synced_at: string | null;
  sync_missing_at: string | null;
}

export interface CatalogDataset {
  id: number;
  name: string;
  connection_id: number;
  connection_name: string | null;
  pbi_workspace_id: string;
  pbi_workspace_name: string | null;
  pbi_dataset_id: string;
  requires_identity: boolean | null;
  reports_count: number;
  synced_at: string | null;
  sync_missing_at: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export type CatalogState = "all" | "missing" | "ok";
export type CatalogWhere = "all" | "root" | "collections";

export interface CatalogFilters {
  search?: string;
  workspace?: string;
  state?: CatalogState;
  where?: CatalogWhere;
  page?: number;
  pageSize?: number;
}

function toParams(filters: CatalogFilters, withWhere: boolean) {
  return {
    search: filters.search || undefined,
    workspace: filters.workspace || undefined,
    state: filters.state && filters.state !== "all" ? filters.state : undefined,
    where: withWhere && filters.where && filters.where !== "all" ? filters.where : undefined,
    page: filters.page ?? 1,
    page_size: filters.pageSize ?? 25,
  };
}

export async function listCatalogReports(filters: CatalogFilters): Promise<Page<CatalogReport>> {
  const { data } = await api.get("/catalog/reports", { params: toParams(filters, true) });
  return data;
}

export async function listCatalogOrigins(): Promise<string[]> {
  const { data } = await api.get("/catalog/origins");
  return data;
}

export async function listCatalogDatasets(filters: CatalogFilters): Promise<Page<CatalogDataset>> {
  const { data } = await api.get("/catalog/datasets", { params: toParams(filters, false) });
  return data;
}

import { api } from "./client";

export interface TenantWorkspace {
  connection_id: number | null;
  connection_name: string | null;
  pbi_workspace_id: string;
  name: string;
  reports: number;
  datasets: number;
  last_synced_at: string | null;
  /** Relatorios novos (ainda na Raiz) sem nenhum acesso */
  pending: number;
}

export interface Face {
  kind: "user" | "group";
  name: string;
  picture_url: string | null;
}

export interface ItemCan {
  open: boolean;
  share: boolean;
  security: boolean;
  refresh: boolean;
  history: boolean;
  folders: boolean;
}

export interface CatalogItem {
  kind: "report" | "dataset";
  id: number;
  name: string;
  connection_id: number | null;
  pbi_workspace_id: string;
  pbi_workspace_name: string;
  collection_id: number | null;
  folders: string[];
  in_root: boolean;
  /** Sincronizacao do catalogo */
  updated_at: string | null;
  /** Ultima e proxima atualizacao dos dados, so quando ja estao no cache do aquecimento */
  last_refresh_at: string | null;
  next_refresh_at: string | null;
  last_refresh_status: string | null;
  missing: boolean;
  dataset_id: number | null;
  dataset_name: string | null;
  reports_count?: number | null;
  rls: { requires_identity: boolean | null; role_grants: number };
  access: { count: number; people: Face[] };
  pending: boolean;
  can: ItemCan;
}

export interface ItemsPage {
  items: CatalogItem[];
  total: number;
  page: number;
  page_size: number;
  pending_total: number;
}

export type ItemKind = "all" | "report" | "dataset";
export type ItemSort = "name" | "kind" | "updated" | "access";

export interface ItemsQuery {
  connectionId?: number | null;
  workspace?: string | null;
  kind?: ItemKind;
  search?: string;
  sort?: ItemSort;
  order?: "asc" | "desc";
  pending?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listTenantWorkspaces(search = ""): Promise<TenantWorkspace[]> {
  const { data } = await api.get("/catalog/workspaces", { params: { search: search || undefined } });
  return data;
}

export async function listItems(query: ItemsQuery): Promise<ItemsPage> {
  const { data } = await api.get("/catalog/items", {
    params: {
      connection_id: query.connectionId ?? undefined,
      workspace: query.workspace || undefined,
      kind: query.kind && query.kind !== "all" ? query.kind : undefined,
      search: query.search || undefined,
      sort: query.sort && query.sort !== "name" ? query.sort : undefined,
      order: query.order && query.order !== "asc" ? query.order : undefined,
      pending: query.pending ? true : undefined,
      page: query.page ?? 1,
      page_size: query.pageSize ?? 25,
    },
  });
  return data;
}

export interface HistoryEntry {
  status: string | null;
  kind: string | null;
  started_at: string | null;
  ended_at: string | null;
  error: string | null;
}

export async function refreshDataset(datasetId: number): Promise<void> {
  await api.post(`/catalog/datasets/${datasetId}/refresh`);
}

export async function getDatasetHistory(datasetId: number): Promise<HistoryEntry[]> {
  const { data } = await api.get(`/catalog/datasets/${datasetId}/history`);
  return data;
}

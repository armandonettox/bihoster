import { api } from "./client";

export type PanelKind = "report" | "dataset" | "connection";
export type SubjectKind = "user" | "group";

export interface Origin {
  kind: "direct" | "folder" | "inherited";
  label: string;
}

export interface PanelEntry {
  subject_kind: SubjectKind;
  subject_id: number;
  name: string;
  email: string | null;
  picture_url: string | null;
  /** Itens dados direto neste item (e o que se edita) */
  permissions: string[];
  /** O que a pessoa ou o grupo pode ao todo (direto mais pastas) */
  effective: string[];
  preset: string | null;
  origins: Origin[];
}

export interface Preset {
  key: string;
  label: string;
  permissions: string[];
}

export interface PermissionItem {
  key: string;
  label: string;
  description: string;
}

export interface Panel {
  item: { kind: PanelKind; id: number; name: string; subtitle: string | null };
  entries: PanelEntry[];
  presets: Preset[];
  permissions: PermissionItem[];
  can_manage: boolean;
}

export interface Subject {
  kind: SubjectKind;
  id: number;
  name: string;
  email: string | null;
  picture_url: string | null;
}

export interface KindCatalog {
  presets: Preset[];
  permissions: PermissionItem[];
}

export interface SubjectItem {
  kind: PanelKind;
  id: number;
  name: string;
  subtitle: string | null;
  in_root: boolean;
  permissions: string[];
  preset: string | null;
}

export interface SubjectItemsPage {
  items: SubjectItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface BulkShareInput {
  items: { kind: PanelKind; id: number }[];
  user_ids: number[];
  group_ids: number[];
  preset?: string | null;
  permissions?: string[] | null;
  mode?: "add" | "remove";
}

export interface BulkResult {
  items: number;
  subjects: number;
  changes: number;
}

export async function getPanel(kind: PanelKind, itemId: number): Promise<Panel> {
  const { data } = await api.get(`/access-panel/${kind}/${itemId}`);
  return data;
}

/** Define o acesso direto de uma pessoa ou grupo: um preset (ver, exportar, atualizar, gerenciar) ou a lista de itens; vazio remove. */
export async function putSubject(
  kind: PanelKind,
  itemId: number,
  subjectKind: SubjectKind,
  subjectId: number,
  value: { preset?: string | null; permissions?: string[] },
): Promise<{ permissions: string[]; preset: string | null }> {
  const { data } = await api.put(`/access-panel/${kind}/${itemId}/${subjectKind}/${subjectId}`, value);
  return data;
}

export async function inviteByEmail(
  kind: PanelKind,
  itemId: number,
  email: string,
  preset: string,
): Promise<{ status: "applied" | "pending" }> {
  const { data } = await api.post(`/access-panel/${kind}/${itemId}/invite`, { email, preset });
  return data;
}

export async function searchSubjects(q: string): Promise<Subject[]> {
  const { data } = await api.get("/access-panel/subjects", { params: { q } });
  return data;
}

export async function getKindCatalog(kind: PanelKind): Promise<KindCatalog> {
  const { data } = await api.get(`/access-panel/catalog/${kind}`);
  return data;
}

export async function itemsOfSubject(
  subjectKind: SubjectKind,
  subjectId: number,
  params: { kind: PanelKind; search?: string; page?: number; pageSize?: number },
): Promise<SubjectItemsPage> {
  const { data } = await api.get(`/access-panel/by-subject/${subjectKind}/${subjectId}`, {
    params: { kind: params.kind, search: params.search || undefined, page: params.page ?? 1, page_size: params.pageSize ?? 10 },
  });
  return data;
}

export async function bulkShare(input: BulkShareInput): Promise<BulkResult> {
  const { data } = await api.post("/access-panel/bulk", input);
  return data;
}

export async function bulkFolders(input: { report_ids: number[]; add: number[]; remove: number[] }): Promise<BulkResult> {
  const { data } = await api.post("/access-panel/bulk-folders", input);
  return data;
}

import { api } from "./client";

export type UserRole = "admin" | "editor" | "viewer";

export interface Workspace {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  /** Pasta onde a coleção fica; vazio = pasta de topo */
  parent_id?: number | null;
  role: UserRole;
}

export interface WorkspaceInput {
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  /** Ao criar: toda colecao nova pode ser vista por todas as pessoas, a nao ser que seja desligado (colecao privada) */
  everyone_can_view?: boolean;
  /** Pasta onde a coleção fica (vazio = pasta de topo). Ao editar, só vale se for enviado */
  parent_id?: number | null;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const { data } = await api.get("/workspaces/");
  return data;
}

/** Uma pasta da arvore. `accessible` falso = so aparece como caminho ate uma subpasta que a pessoa acessa. */
export interface TreeNode {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  color: string | null;
  parent_id: number | null;
  accessible: boolean;
}

export async function getWorkspaceTree(): Promise<TreeNode[]> {
  const { data } = await api.get("/workspaces/tree");
  return data;
}

export async function listAllWorkspaces(): Promise<Workspace[]> {
  const { data } = await api.get("/workspaces/all");
  return data;
}

export async function createWorkspace(input: WorkspaceInput): Promise<Workspace> {
  const { data } = await api.post("/workspaces/", input);
  return data;
}

export async function updateWorkspace(id: number, input: Partial<WorkspaceInput>): Promise<Workspace> {
  const { data } = await api.put(`/workspaces/${id}`, input);
  return data;
}

export async function deleteWorkspace(id: number): Promise<void> {
  await api.delete(`/workspaces/${id}`);
}

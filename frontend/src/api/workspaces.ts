import { api } from "./client";

export type UserRole = "admin" | "editor" | "viewer";

export interface Workspace {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  tv_interval_seconds: number;
  role: UserRole;
}

export interface WorkspaceInput {
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  tv_interval_seconds?: number;
}

export interface AccessEntry {
  group_id: number;
  group_name: string;
  is_default: boolean;
  is_admin_group: boolean;
  role: UserRole | null;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const { data } = await api.get("/workspaces/");
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

export async function getWorkspaceAccess(workspaceId: number): Promise<AccessEntry[]> {
  const { data } = await api.get(`/workspaces/${workspaceId}/access`);
  return data;
}

export async function setWorkspaceAccess(workspaceId: number, groupId: number, role: UserRole): Promise<AccessEntry> {
  const { data } = await api.put(`/workspaces/${workspaceId}/access/${groupId}`, { role });
  return data;
}

export async function removeWorkspaceAccess(workspaceId: number, groupId: number): Promise<AccessEntry> {
  const { data } = await api.delete(`/workspaces/${workspaceId}/access/${groupId}`);
  return data;
}

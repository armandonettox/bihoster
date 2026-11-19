import { api } from "./client";

export interface UserGroup {
  id: number;
  name: string;
  is_default: boolean;
  is_admin_group: boolean;
}

export interface UserDirectoryEntry {
  id: number;
  name: string;
  email: string;
  groups: UserGroup[];
  last_login: string | null;
}

export async function listUsers(): Promise<UserDirectoryEntry[]> {
  const { data } = await api.get("/users/");
  return data;
}

export async function generateResetLink(userId: number): Promise<{ token: string; expires_in_minutes: number }> {
  const { data } = await api.post(`/users/${userId}/reset-link`);
  return data;
}

export async function deleteUser(userId: number): Promise<void> {
  await api.delete(`/users/${userId}`);
}

export interface PendingInvite {
  id: number;
  email: string;
  group_id: number;
  group_name: string;
  created_at: string;
}

export async function listPendingInvites(): Promise<PendingInvite[]> {
  const { data } = await api.get("/users/pending-invites");
  return data;
}

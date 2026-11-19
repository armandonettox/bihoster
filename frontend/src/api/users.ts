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
  is_blocked: boolean;
}

export async function listUsers(): Promise<UserDirectoryEntry[]> {
  const { data } = await api.get("/users/");
  return data;
}

export async function generateResetLink(userId: number): Promise<{ token: string; expires_in_minutes: number }> {
  const { data } = await api.post(`/users/${userId}/reset-link`);
  return data;
}

/** Manda para o e-mail da própria pessoa o link de nova senha. O link não volta para quem pediu. */
export async function sendResetEmail(userId: number): Promise<void> {
  await api.post(`/users/${userId}/send-reset-email`);
}

/** Avisa por e-mail que a pessoa foi adicionada (ou convidada), com o link para entrar. */
export async function sendWelcomeEmail(email: string): Promise<{ status: string; email: string; kind: "added" | "invited" }> {
  const { data } = await api.post("/users/welcome-email", { email });
  return data;
}

export async function blockUser(userId: number): Promise<void> {
  await api.post(`/users/${userId}/block`);
}

export async function unblockUser(userId: number): Promise<void> {
  await api.post(`/users/${userId}/unblock`);
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

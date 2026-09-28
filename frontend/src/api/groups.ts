import { api } from "./client";

export interface Group {
  id: number;
  name: string;
  is_default: boolean;
  is_admin_group: boolean;
}

export interface GroupMember {
  user_id: number;
  name: string;
  email: string;
}

export async function listGroups(): Promise<Group[]> {
  const { data } = await api.get("/groups/");
  return data;
}

export async function createGroup(name: string): Promise<Group> {
  const { data } = await api.post("/groups/", { name });
  return data;
}

export async function updateGroup(groupId: number, name: string): Promise<Group> {
  const { data } = await api.put(`/groups/${groupId}`, { name });
  return data;
}

export async function deleteGroup(groupId: number): Promise<void> {
  await api.delete(`/groups/${groupId}`);
}

export async function listGroupMembers(groupId: number): Promise<GroupMember[]> {
  const { data } = await api.get(`/groups/${groupId}/members`);
  return data;
}

export async function addGroupMember(groupId: number, email: string): Promise<GroupMember> {
  const { data } = await api.post(`/groups/${groupId}/members`, { email });
  return data;
}

export async function removeGroupMember(groupId: number, userId: number): Promise<void> {
  await api.delete(`/groups/${groupId}/members/${userId}`);
}

export interface GroupInvite {
  id: number;
  email: string;
  group_id: number;
}

export async function inviteGroupMember(groupId: number, email: string): Promise<{ status: "added" | "invited"; email: string }> {
  const { data } = await api.post(`/groups/${groupId}/invite`, { email });
  return data;
}

export async function listGroupInvites(groupId: number): Promise<GroupInvite[]> {
  const { data } = await api.get(`/groups/${groupId}/invites`);
  return data;
}

export async function cancelGroupInvite(groupId: number, inviteId: number): Promise<void> {
  await api.delete(`/groups/${groupId}/invites/${inviteId}`);
}

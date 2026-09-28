import { api } from "./client";

export interface User {
  id: number;
  name: string;
  email: string;
  is_platform_admin: boolean;
}

export async function login(email: string, password: string): Promise<string> {
  const { data } = await api.post("/auth/login", { email, password });
  return data.access_token as string;
}

export async function register(name: string, email: string, password: string): Promise<User> {
  const { data } = await api.post("/auth/register", { name, email, password });
  return data as User;
}

export async function me(): Promise<User> {
  const { data } = await api.get("/auth/me");
  return data as User;
}

export async function loginWithGoogle(idToken: string): Promise<string> {
  const { data } = await api.post("/auth/google", { id_token: idToken });
  return data.access_token as string;
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await api.post("/auth/reset-password", { token, new_password: newPassword });
}

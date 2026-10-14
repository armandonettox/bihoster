import { api } from "./client";

export interface User {
  id: number;
  name: string;
  email: string;
  is_platform_admin: boolean;
  /** false para conta criada pelo login com Google (nao tem senha para trocar). Ausente em backend antigo. */
  can_change_password?: boolean;
}

export async function login(email: string, password: string): Promise<string> {
  const { data } = await api.post("/auth/login", { email, password });
  return data.access_token as string;
}

/** Troca o token atual por um novo (sessao deslizante), sem pedir senha de novo. */
export async function refreshSession(): Promise<string> {
  const { data } = await api.post("/auth/refresh");
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

/** O proprio usuario troca o nome. Devolve o usuario atualizado. */
export async function updateName(name: string): Promise<User> {
  const { data } = await api.patch("/auth/me", { name });
  return data as User;
}

/** O proprio usuario troca a senha. Devolve o token novo: o de antes deixa de valer. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<string> {
  const { data } = await api.post("/auth/change-password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
  return data.access_token as string;
}

export async function loginWithGoogle(idToken: string): Promise<string> {
  const { data } = await api.post("/auth/google", { id_token: idToken });
  return data.access_token as string;
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await api.post("/auth/reset-password", { token, new_password: newPassword });
}

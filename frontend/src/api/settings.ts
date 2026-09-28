import { api } from "./client";

export type LoginLayout = "centered" | "split";

export interface AppSettings {
  company_name: string;
  primary_color: string;
  secondary_color: string;
  logo_url: string | null;
  favicon_url: string | null;
  login_image_url: string | null;
  login_layout: LoginLayout;
  timezone: string;
  site_url: string | null;
  support_email: string | null;
  force_https: boolean;
  default_workspace_id: number | null;
  allow_registration: boolean;
  google_oauth_enabled: boolean;
  google_client_id: string | null;
  google_client_secret_configured: boolean;
  google_allowed_domains: string | null;
}

export interface AppSettingsUpdate extends Partial<Omit<AppSettings, "google_client_secret_configured">> {
  google_client_secret?: string | null;
}

export async function getSettings(): Promise<AppSettings> {
  const { data } = await api.get("/settings/");
  return data;
}

export async function updateSettings(input: AppSettingsUpdate): Promise<AppSettings> {
  const { data } = await api.put("/settings/", input);
  return data;
}

export async function uploadLogo(file: File): Promise<AppSettings> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/settings/logo", form);
  return data;
}

export async function uploadFavicon(file: File): Promise<AppSettings> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/settings/favicon", form);
  return data;
}

export async function removeLogo(): Promise<AppSettings> {
  const { data } = await api.delete("/settings/logo");
  return data;
}

export async function removeFavicon(): Promise<AppSettings> {
  const { data } = await api.delete("/settings/favicon");
  return data;
}

export async function uploadLoginImage(file: File): Promise<AppSettings> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/settings/login-image", form);
  return data;
}

export async function removeLoginImage(): Promise<AppSettings> {
  const { data } = await api.delete("/settings/login-image");
  return data;
}

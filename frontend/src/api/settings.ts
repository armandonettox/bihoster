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
  single_collection_redirect: boolean;
  default_workspace_id: number | null;
  /** Textos das telas de erro. Nulo = usar o texto padrão da interface. */
  not_found_title: string | null;
  not_found_message: string | null;
  not_found_button: string | null;
  error_title: string | null;
  error_message: string | null;
  error_button: string | null;
  /** Textos das telas de aviso (fora do horário e sem acesso a coleção). Nulo = usar o texto padrão. */
  outside_hours_title: string | null;
  outside_hours_message: string | null;
  outside_hours_button: string | null;
  no_access_title: string | null;
  no_access_message: string | null;
  no_access_button: string | null;
  allow_registration: boolean;
  google_oauth_enabled: boolean;
  google_client_id: string | null;
  google_client_secret_configured: boolean;
  google_allowed_domains: string | null;
  cache_warmup_enabled: boolean;
  cache_warmup_interval_seconds: number;
  /** Pre-carregar os scripts do Power BI no navegador (vem ligado: e o que sempre rodou) */
  embed_preload_enabled: boolean;
  /** Aquecer so os relatorios abertos nas ultimas horas (vem desligado) */
  cache_warmup_only_recent: boolean;
  cache_warmup_recent_hours: number;
  /** Chave geral do controle da capacidade do Power BI (vem desligada) */
  capacity_control_enabled: boolean;
  /** Deixa relatorio com RLS sair por e-mail, arquivo e TV (vem desligado) */
  rls_output_enabled: boolean;
}

export interface CacheStats {
  warmup_enabled: boolean;
  warmup_interval_seconds: number;
  warmup_running: boolean;
  last_run_at: string | null;
  last_run_stats: {
    relatorios?: number;
    tokens_novos?: number;
    datasets?: number;
    erros?: number;
  };
  embed_tokens: number;
  report_static: number;
  refresh_info: number;
  total_entries: number;
}

export async function getCacheStats(): Promise<CacheStats> {
  const { data } = await api.get("/settings/cache/stats");
  return data;
}

export async function resetCache(): Promise<CacheStats> {
  const { data } = await api.delete("/settings/cache");
  return data;
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

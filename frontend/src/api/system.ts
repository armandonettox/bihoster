import { api } from "./client";

export interface ReleaseInfo {
  version: string;
  name: string;
  changelog: string;
  published_at: string | null;
  is_current: boolean;
}

export interface VersionStatus {
  current_version: string;
  latest: ReleaseInfo | null;
  has_update: boolean;
  /** true quando a consulta ao GitHub falhou: nao da pra afirmar que esta atualizado */
  check_failed: boolean;
  auto_update_enabled: boolean;
}

export interface ApplyUpdateResult {
  status: string;
  target_version: string;
  log_file: string;
  /** Nome da cópia do banco feita antes de atualizar (null quando o banco não é um arquivo) */
  backup_file: string | null;
  message: string;
}

export async function getCurrentVersion(): Promise<string> {
  const { data } = await api.get("/system/current-version");
  return data.current_version;
}

/** `refresh`: o botao "Verificar agora", que consulta o GitHub de novo em vez de usar a resposta guardada */
export async function getVersionStatus(refresh = false): Promise<VersionStatus> {
  const { data } = await api.get("/system/version", refresh ? { params: { refresh: true } } : undefined);
  return data;
}

export async function getVersionHistory(): Promise<ReleaseInfo[]> {
  const { data } = await api.get("/system/version/history");
  return data;
}

export async function applyUpdate(): Promise<ApplyUpdateResult> {
  const { data } = await api.post("/system/version/apply");
  return data;
}

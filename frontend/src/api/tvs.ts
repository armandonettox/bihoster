import { api } from "./client";

/** "ver" inclui utilizar (abrir o link, ver o codigo, desconectar); "modificar" inclui ver. */
export type TvLevel = "ver" | "modificar";
export type TvItemKind = "report_page" | "image" | "youtube";

export interface TvSummary {
  id: number;
  name: string;
  level: TvLevel;
  items_count: number;
  total_seconds: number;
  /** Vazio = a TV fica conectada para sempre */
  session_hours: number | null;
  /** De quantos em quantos minutos a TV atualiza os dados dos relatorios; vazio = nao atualiza sozinha */
  refresh_minutes: number | null;
  online: boolean;
  last_seen_at: string | null;
}

export interface TvItem {
  id: number;
  kind: TvItemKind;
  seconds: number;
  report_id: number | null;
  report_name: string | null;
  collection_name: string | null;
  page_name: string | null;
  image_url: string | null;
  video_id: string | null;
  sound: boolean;
  /** Relatorio com RLS: a funcao de seguranca que a TV usa */
  rls_role?: string | null;
}

export interface TvDetail extends TvSummary {
  /** A parte secreta do endereco que a TV abre */
  link_secret: string;
  items: TvItem[];
}

/** Um item para salvar: a lista inteira vai de uma vez, na ordem em que deve passar. */
export interface TvItemInput {
  kind: TvItemKind;
  seconds: number;
  report_id?: number | null;
  page_name?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  sound?: boolean;
  rls_role?: string | null;
}

export interface TvCode {
  code: string;
  expires_in_seconds: number;
  step_seconds: number;
}

export interface TvGrant {
  user_id: number | null;
  group_id: number | null;
  name: string;
  level: TvLevel;
}

export interface TvGrantInput {
  user_id?: number | null;
  group_id?: number | null;
  level: TvLevel;
}

export interface TvPerson {
  id: number;
  name: string;
  email: string | null;
}

export interface TvReportChoice {
  id: number;
  name: string;
  collection_id: number;
  collection_name: string;
}

export interface TvPageChoice {
  name: string;
  title: string;
}

/** O endereco completo que a TV abre (o link secreto), para copiar ou abrir em outra aba. */
export function tvLinkUrl(secret: string): string {
  return `${window.location.origin}/tv/p/${secret}`;
}

export async function listTvs(): Promise<TvSummary[]> {
  const { data } = await api.get("/tvs");
  return data;
}

export async function createTv(name: string): Promise<TvDetail> {
  const { data } = await api.post("/tvs", { name });
  return data;
}

export async function getTv(id: number): Promise<TvDetail> {
  const { data } = await api.get(`/tvs/${id}`);
  return data;
}

export async function updateTv(id: number, changes: { name?: string; session_hours?: number | null; refresh_minutes?: number | null }): Promise<TvDetail> {
  const { data } = await api.put(`/tvs/${id}`, changes);
  return data;
}

export async function deleteTv(id: number): Promise<void> {
  await api.delete(`/tvs/${id}`);
}

export async function replaceTvItems(id: number, items: TvItemInput[]): Promise<TvDetail> {
  const { data } = await api.put(`/tvs/${id}/items`, { items });
  return data;
}

export async function uploadTvImage(id: number, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post(`/tvs/${id}/image`, form);
  return data.image_url;
}

export async function getTvCode(id: number): Promise<TvCode> {
  const { data } = await api.get(`/tvs/${id}/code`);
  return data;
}

export async function disconnectTv(id: number): Promise<void> {
  await api.post(`/tvs/${id}/disconnect`);
}

export async function regenerateTvLink(id: number): Promise<TvDetail> {
  const { data } = await api.post(`/tvs/${id}/regenerate-link`);
  return data;
}

export async function getTvGrants(id: number): Promise<TvGrant[]> {
  const { data } = await api.get(`/tvs/${id}/grants`);
  return data;
}

export async function replaceTvGrants(id: number, grants: TvGrantInput[]): Promise<TvGrant[]> {
  const { data } = await api.put(`/tvs/${id}/grants`, { grants });
  return data;
}

export async function listTvPeople(): Promise<{ users: TvPerson[]; groups: TvPerson[] }> {
  const { data } = await api.get("/tvs/people");
  return data;
}

export async function listTvReports(): Promise<TvReportChoice[]> {
  const { data } = await api.get("/tvs/available-reports");
  return data;
}

export async function listTvReportPages(reportId: number): Promise<TvPageChoice[]> {
  const { data } = await api.get(`/tvs/report-pages/${reportId}`);
  return data;
}

/** Para a tela de montar a TV: o relatorio tem RLS, a chave geral esta ligada e quais funcoes a pessoa tem nele. */
export interface ReportRlsInfo {
  rls: boolean;
  switch_on: boolean;
  roles: string[];
}

export async function getReportRls(reportId: number): Promise<ReportRlsInfo> {
  const { data } = await api.get(`/tvs/report-rls/${reportId}`);
  return data;
}


import axios from "axios";
import type { EmbedConfig } from "./reports";
import { safeStorage } from "../utils/safeStorage";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Cliente proprio, sem os interceptadores do app: a TV nao e uma pessoa logada. Um 401 aqui significa "conexao da TV
// encerrada" e nunca pode apagar o token de uma pessoa nem mandar para a tela de login.
const player = axios.create({ baseURL: `${API_URL}/tv-player` });

export interface PlayerItem {
  id: number;
  report_id: number | null;
  kind: "report_page" | "image" | "youtube";
  seconds: number;
  report_name: string | null;
  page_name: string | null;
  image_url: string | null;
  video_id: string | null;
  sound: boolean;
}

export interface Playlist {
  name: string;
  refresh_minutes?: number | null;
  items: PlayerItem[];
}

const storageKey = (secret: string) => `tv_token_${secret}`;

export function savedTvToken(secret: string): string | null {
  return safeStorage.getItem(storageKey(secret));
}

export function forgetTvToken(secret: string) {
  safeStorage.removeItem(storageKey(secret));
}

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/** Confere se o link existe (sem dar nenhum dado da TV). */
export async function linkExists(secret: string): Promise<boolean> {
  try {
    await player.get(`/${encodeURIComponent(secret)}/name`);
    return true;
  } catch {
    return false;
  }
}

/** Troca o codigo pelo token da TV e guarda o token neste aparelho. */
export async function connectTv(secret: string, code: string): Promise<string> {
  const { data } = await player.post(`/${encodeURIComponent(secret)}/connect`, { code });
  safeStorage.setItem(storageKey(secret), data.token);
  return data.token;
}

export async function fetchPlaylist(token: string): Promise<Playlist> {
  const { data } = await player.get("/playlist", auth(token));
  return data;
}

export async function fetchItemEmbed(token: string, itemId: number): Promise<EmbedConfig> {
  const { data } = await player.get(`/items/${itemId}/embed`, auth(token));
  return data;
}

import axios from "axios";
import { safeStorage } from "../utils/safeStorage";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: API_URL,
});

export function assetUrl(path: string): string {
  return `${API_URL}${path}`;
}

/** Extrai uma mensagem legivel de um erro do axios -- lida tanto com HTTPException
 * ({detail: "..."}) quanto com erro de validacao do Pydantic ({detail: [{msg, loc}, ...]}). */
export function extractErrorMessage(err: any): string | null {
  const detail = err?.response?.data?.detail;
  if (!detail) return null;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg).join(" ");
  return null;
}

api.interceptors.request.use((config) => {
  const token = safeStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const hadToken = !!safeStorage.getItem("token");
    if (error.response?.status === 401 && hadToken) {
      safeStorage.removeItem("token");
      // No Modo TV (kiosk sem ninguem por perto), redirecionar pro login silenciosamente
      // deixa a tela "morta" sem ninguem notar -- em vez disso deixa a propria pagina
      // mostrar o erro (TvPlaylistPlayer ja trata isso), visivel pra quem passar na frente.
      const isTvKiosk = window.location.pathname.startsWith("/tv/");
      if (!isTvKiosk && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

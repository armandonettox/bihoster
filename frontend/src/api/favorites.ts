import { api } from "./client";
import type { Report } from "./reports";

export async function listFavorites(): Promise<Report[]> {
  const { data } = await api.get("/favorites/");
  return data;
}

export async function addFavorite(reportId: number): Promise<void> {
  await api.post(`/favorites/${reportId}`);
}

export async function removeFavorite(reportId: number): Promise<void> {
  await api.delete(`/favorites/${reportId}`);
}

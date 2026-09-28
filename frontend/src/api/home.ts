import { api } from "./client";

export interface HomeCollectionEntry {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  color: string | null;
}

export async function recordCollectionView(workspaceId: number): Promise<void> {
  await api.post(`/home/collections/${workspaceId}/view`);
}

export async function listRecentCollections(): Promise<HomeCollectionEntry[]> {
  const { data } = await api.get("/home/recent");
  return data;
}

export async function listRecommendedCollections(): Promise<HomeCollectionEntry[]> {
  const { data } = await api.get("/home/recommended");
  return data;
}

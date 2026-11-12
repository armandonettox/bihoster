import { api } from "./client";

/** O que a pessoa logada pode fazer nos analiticos. Quem manda de verdade e o servidor, em cada rota. */
export interface AnalyticsAccess {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export async function getAnalyticsAccess(): Promise<AnalyticsAccess> {
  const { data } = await api.get("/analytics/access");
  return data;
}

import type { AuditPeriod } from "./auditPeriod";

export interface AuditFilterState {
  period: AuditPeriod;
  customFrom: string;
  customTo: string;
  /** Selecao multipla: lista vazia = sem filtro */
  userIds: string[];
  actions: string[];
  entities: string[];
  workspaceIds: string[];
  reportIds: string[];
}

export const DEFAULT_FILTERS: AuditFilterState = {
  period: "30d",
  customFrom: "",
  customTo: "",
  userIds: [],
  actions: [],
  entities: [],
  workspaceIds: [],
  reportIds: [],
};

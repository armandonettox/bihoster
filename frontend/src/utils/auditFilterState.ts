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

const sameValues = (a: string[], b: string[]) => a.length === b.length && a.every((value) => b.includes(value));

/**
 * Aplica o filtro pedido por um clique num visual. Clicar de novo no mesmo valor tira o filtro:
 * a lista volta a vazia (ou o periodo volta ao padrao, no caso de um dia). Valor diferente
 * substitui o filtro daquele campo, e campos diferentes se somam.
 */
export function toggleFilter(current: AuditFilterState, patch: Partial<AuditFilterState>): AuditFilterState {
  const next: AuditFilterState = { ...current };
  for (const [name, value] of Object.entries(patch) as [keyof AuditFilterState, unknown][]) {
    if (Array.isArray(value)) {
      const key = name as "userIds" | "actions" | "entities" | "workspaceIds" | "reportIds";
      next[key] = sameValues(current[key], value as string[]) ? [] : (value as string[]);
    }
  }
  if (patch.period === "custom") {
    const sameDay = current.period === "custom" && current.customFrom === patch.customFrom && current.customTo === patch.customTo;
    if (sameDay) {
      next.period = DEFAULT_FILTERS.period;
      next.customFrom = "";
      next.customTo = "";
    } else {
      next.period = "custom";
      next.customFrom = patch.customFrom ?? "";
      next.customTo = patch.customTo ?? "";
    }
  }
  return next;
}

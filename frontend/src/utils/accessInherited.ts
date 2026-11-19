import type { ReportRow } from "../api/access";
import { scopeKey } from "./accessDraft";

/** O que uma pessoa já recebe por grupos: escopo ("global" ou id da coleção) e, em cada um, a permissão com os nomes dos
 * grupos de onde vem. Essas permissões não se editam na pessoa, só no grupo. */
export type Inherited = Record<string, Record<string, string[]>>;

export function inheritedFromReport(rows: ReportRow[]): Inherited {
  const result: Inherited = {};
  for (const row of rows) {
    if (row.is_admin) continue;
    const scope = scopeKey(row.workspace_id);
    for (const permission of row.permissions) {
      if (permission.groups.length === 0) continue;
      result[scope] = { ...(result[scope] ?? {}), [permission.key]: permission.groups };
    }
  }
  return result;
}

export interface AccessSummary {
  isAdmin: boolean;
  /** Quantas permissões a pessoa tem, somando o sistema todo e cada coleção */
  count: number;
  /** Tem alguma permissão dada direto a ela, fora dos grupos */
  hasDirect: boolean;
  /** A lista por escopo, para a dica ao passar o cursor */
  title: string;
}

/** Resumo de permissões de cada pessoa (por id), a partir das linhas do relatório de permissões. */
export function summarizeAccess(rows: ReportRow[]): Map<number, AccessSummary> {
  const byUser = new Map<number, ReportRow[]>();
  for (const row of rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);

  const result = new Map<number, AccessSummary>();
  for (const [userId, userRows] of byUser) {
    if (userRows.some((row) => row.is_admin)) {
      result.set(userId, { isAdmin: true, count: 0, hasDirect: false, title: "Todas as permissões, em todas as coleções" });
      continue;
    }
    const withPermissions = userRows.filter((row) => row.permissions.length > 0);
    result.set(userId, {
      isAdmin: false,
      count: withPermissions.reduce((total, row) => total + row.permissions.length, 0),
      hasDirect: withPermissions.some((row) => row.permissions.some((permission) => permission.direct)),
      title:
        withPermissions.length === 0
          ? "Nenhuma permissão"
          : withPermissions.map((row) => `${row.scope_label}: ${row.permissions.map((p) => p.label).join(", ")}`).join("\n"),
    });
  }
  return result;
}

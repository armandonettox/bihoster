import { describe, expect, it } from "vitest";
import type { DashboardWidget, WidgetQuery } from "../../../api/audit";
import { isFilterable, isStatSelected, patchForKey, patchForStat, selectedKeys, statAction } from "./interactions";

function builtIn(type: DashboardWidget["type"], source: string): DashboardWidget {
  return { id: "w", type, source, title: null, color: null, query: null, x: 0, y: 0, w: 4, h: 2 };
}

function custom(type: DashboardWidget["type"], query: Partial<WidgetQuery>): DashboardWidget {
  return {
    ...builtIn(type, "custom"),
    query: { metric: "events", group_by: "action", limit: 8, ...query },
  };
}

describe("patchForKey - o que clicar num item filtra", () => {
  it("visuais padrao: dia, acao, pessoa, colecao e relatorio", () => {
    expect(patchForKey(builtIn("line", "by_day"), "2026-11-10")).toEqual({ period: "custom", customFrom: "2026-11-10", customTo: "2026-11-10" });
    expect(patchForKey(builtIn("bars", "by_action"), "login")).toEqual({ actions: ["login"] });
    expect(patchForKey(builtIn("bars", "top_users"), "7")).toEqual({ userIds: ["7"] });
    expect(patchForKey(builtIn("bars", "top_collections"), "2")).toEqual({ workspaceIds: ["2"] });
    expect(patchForKey(builtIn("bars", "top_reports"), "11")).toEqual({ reportIds: ["11"] });
  });

  it("visuais personalizados seguem o agrupamento da consulta", () => {
    expect(patchForKey(custom("bars", { group_by: "action" }), "login")).toEqual({ actions: ["login"] });
    expect(patchForKey(custom("donut", { group_by: "entity" }), "report")).toEqual({ entities: ["report"] });
    expect(patchForKey(custom("table", { group_by: "user" }), "3")).toEqual({ userIds: ["3"] });
    expect(patchForKey(custom("bars", { group_by: "collection" }), "2")).toEqual({ workspaceIds: ["2"] });
    expect(patchForKey(custom("bars", { group_by: "report" }), "12")).toEqual({ reportIds: ["12"] });
    expect(patchForKey(custom("line", { group_by: "day" }), "2026-11-09")).toEqual({
      period: "custom",
      customFrom: "2026-11-09",
      customTo: "2026-11-09",
    });
  });

  it("hora, dia da semana e metodo de login nao tem filtro na pagina: nao filtram", () => {
    expect(patchForKey(builtIn("hours", "by_hour"), "9")).toBeNull();
    expect(patchForKey(builtIn("donut", "login_methods"), "google")).toBeNull();
    expect(patchForKey(custom("line", { group_by: "hour" }), "9")).toBeNull();
    expect(patchForKey(custom("bars", { group_by: "weekday" }), "1")).toBeNull();
    expect(patchForKey(custom("donut", { metric: "logins", group_by: "login_method" }), "google")).toBeNull();
    expect(patchForKey(builtIn("bars", "fonte_nova"), "x")).toBeNull();
  });

  it("isFilterable diz se o visual aceita clique nos itens", () => {
    expect(isFilterable(builtIn("bars", "by_action"))).toBe(true);
    expect(isFilterable(custom("line", { group_by: "day" }))).toBe(true);
    expect(isFilterable(builtIn("hours", "by_hour"))).toBe(false);
    expect(isFilterable(custom("bars", { group_by: "weekday" }))).toBe(false);
  });
});

describe("cartoes de numero", () => {
  it("os que contam uma acao filtram por ela; os gerais nao filtram", () => {
    expect(patchForStat(builtIn("stat", "logins_ok"))).toEqual({ actions: ["login"] });
    expect(patchForStat(builtIn("stat", "logins_blocked"))).toEqual({ actions: ["login_blocked"] });
    expect(patchForStat(builtIn("stat", "accounts_locked"))).toEqual({ actions: ["account_locked"] });
    expect(patchForStat(builtIn("stat", "events"))).toBeNull();
    expect(patchForStat(builtIn("stat", "active_users"))).toBeNull();
  });

  it("cartoes personalizados usam a medida", () => {
    expect(statAction(custom("stat", { metric: "logins", group_by: "none" }))).toBe("login");
    expect(statAction(custom("stat", { metric: "report_opens", group_by: "none" }))).toBe("view_report");
    expect(statAction(custom("stat", { metric: "collection_visits", group_by: "none" }))).toBe("view_collection");
    expect(statAction(custom("stat", { metric: "changes", group_by: "none" }))).toBeNull();
    expect(statAction(custom("stat", { metric: "people", group_by: "none" }))).toBeNull();
  });

  it("o cartao fica destacado so quando a pagina esta filtrada exatamente pela acao dele", () => {
    const logins = builtIn("stat", "logins_ok");
    expect(isStatSelected(logins, { action: ["login"] })).toBe(true);
    expect(isStatSelected(logins, { action: ["login", "login_blocked"] })).toBe(false);
    expect(isStatSelected(logins, { action: ["login_blocked"] })).toBe(false);
    expect(isStatSelected(logins, {})).toBe(false);
    expect(isStatSelected(builtIn("stat", "events"), { action: ["login"] })).toBe(false);
  });
});

describe("selectedKeys - o que ja esta filtrado e deve ficar destacado", () => {
  it("le cada filtro da pagina na forma que o visual usa como chave", () => {
    expect(selectedKeys(builtIn("bars", "by_action"), { action: ["login"] })).toEqual(["login"]);
    expect(selectedKeys(builtIn("bars", "top_users"), { user_id: [7, 8] })).toEqual(["7", "8"]);
    expect(selectedKeys(builtIn("bars", "top_collections"), { workspace_id: [2] })).toEqual(["2"]);
    expect(selectedKeys(builtIn("bars", "top_reports"), { report_id: [11] })).toEqual(["11"]);
    expect(selectedKeys(custom("donut", { group_by: "entity" }), { entity: ["report"] })).toEqual(["report"]);
  });

  it("dia: so conta quando o periodo e um dia unico", () => {
    expect(selectedKeys(builtIn("line", "by_day"), { date_from: "2026-11-10", date_to: "2026-11-10" })).toEqual(["2026-11-10"]);
    expect(selectedKeys(builtIn("line", "by_day"), { date_from: "2026-11-01", date_to: "2026-11-10" })).toEqual([]);
    expect(selectedKeys(builtIn("line", "by_day"), {})).toEqual([]);
  });

  it("visual sem filtro correspondente nunca tem item destacado", () => {
    expect(selectedKeys(builtIn("hours", "by_hour"), { action: ["login"] })).toEqual([]);
    expect(selectedKeys(builtIn("bars", "by_action"), {})).toEqual([]);
  });
});

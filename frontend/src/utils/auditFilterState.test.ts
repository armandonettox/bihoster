import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, toggleFilter, type AuditFilterState } from "./auditFilterState";

const base = (over: Partial<AuditFilterState> = {}): AuditFilterState => ({ ...DEFAULT_FILTERS, ...over });

describe("toggleFilter", () => {
  it("aplica o filtro pedido", () => {
    expect(toggleFilter(base(), { actions: ["login"] }).actions).toEqual(["login"]);
    expect(toggleFilter(base(), { userIds: ["7"] }).userIds).toEqual(["7"]);
    expect(toggleFilter(base(), { entities: ["report"] }).entities).toEqual(["report"]);
    expect(toggleFilter(base(), { workspaceIds: ["2"] }).workspaceIds).toEqual(["2"]);
    expect(toggleFilter(base(), { reportIds: ["11"] }).reportIds).toEqual(["11"]);
  });

  it("clicar de novo no mesmo valor tira o filtro", () => {
    const once = toggleFilter(base(), { actions: ["login"] });
    expect(toggleFilter(once, { actions: ["login"] }).actions).toEqual([]);
  });

  it("valor diferente no mesmo campo substitui, sem somar", () => {
    const once = toggleFilter(base({ actions: ["login", "view_report"] }), { actions: ["login_blocked"] });
    expect(once.actions).toEqual(["login_blocked"]);
  });

  it("campos diferentes se somam e nao mexem uns nos outros", () => {
    const state = toggleFilter(toggleFilter(base(), { actions: ["login"] }), { userIds: ["7"] });
    expect(state).toMatchObject({ actions: ["login"], userIds: ["7"] });

    const cleared = toggleFilter(state, { actions: ["login"] });
    expect(cleared).toMatchObject({ actions: [], userIds: ["7"] });
  });

  it("dia: aplica o periodo de um dia e clicar no mesmo dia volta ao periodo padrao", () => {
    const day = { period: "custom" as const, customFrom: "2026-11-10", customTo: "2026-11-10" };
    const picked = toggleFilter(base(), day);
    expect(picked).toMatchObject(day);

    const back = toggleFilter(picked, day);
    expect(back.period).toBe(DEFAULT_FILTERS.period);
    expect(back.customFrom).toBe("");
    expect(back.customTo).toBe("");
  });

  it("outro dia troca o dia; um dia depois de um intervalo personalizado tambem aplica", () => {
    const nov10 = { period: "custom" as const, customFrom: "2026-11-10", customTo: "2026-11-10" };
    const nov09 = { period: "custom" as const, customFrom: "2026-11-09", customTo: "2026-11-09" };
    expect(toggleFilter(toggleFilter(base(), nov10), nov09)).toMatchObject(nov09);
    expect(toggleFilter(base({ period: "custom", customFrom: "2026-11-01", customTo: "2026-11-30" }), nov10)).toMatchObject(nov10);
  });

  it("combina dia e outro filtro no mesmo clique sem perder o resto", () => {
    const state = toggleFilter(base({ userIds: ["7"] }), { period: "custom", customFrom: "2026-11-10", customTo: "2026-11-10" });
    expect(state).toMatchObject({ userIds: ["7"], period: "custom", customFrom: "2026-11-10" });
  });

  it("nao altera o estado original", () => {
    const original = base({ actions: ["login"] });
    toggleFilter(original, { actions: ["login"] });
    expect(original.actions).toEqual(["login"]);
  });
});

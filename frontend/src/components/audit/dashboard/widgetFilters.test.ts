import { describe, expect, it } from "vitest";
import { isEmptyWidgetFilters, mergeFilters } from "./widgetFilters";

describe("isEmptyWidgetFilters", () => {
  it("vazio quando nao ha filtro ou nenhum campo tem valor", () => {
    expect(isEmptyWidgetFilters(null)).toBe(true);
    expect(isEmptyWidgetFilters(undefined)).toBe(true);
    expect(isEmptyWidgetFilters({ action: [], user_id: [] })).toBe(true);
    expect(isEmptyWidgetFilters({ action: ["login"] })).toBe(false);
  });
});

describe("mergeFilters", () => {
  it("sem filtro do visual devolve os da pagina como estao", () => {
    const page = { action: ["login"], date_from: "2026-11-01" };
    expect(mergeFilters(page, null)).toBe(page);
  });

  it("campos diferentes valem juntos e o periodo da pagina fica", () => {
    const merged = mergeFilters({ user_id: [1], date_from: "2026-11-01" }, { workspace_id: [7] });
    expect(merged).toEqual({ user_id: [1], workspace_id: [7], date_from: "2026-11-01" });
  });

  it("sem filtro da pagina no campo vale o do visual", () => {
    expect(mergeFilters({}, { action: ["login", "view_report"] }).action).toEqual(["login", "view_report"]);
  });

  it("no mesmo campo vale a intersecao", () => {
    expect(mergeFilters({ user_id: [1, 2] }, { user_id: [2, 3] }).user_id).toEqual([2]);
    expect(mergeFilters({ action: ["a", "b"] }, { action: ["b", "c"] }).action).toEqual(["b"]);
  });

  it("intersecao vazia vira um valor que nao existe, para o servidor devolver zero", () => {
    const merged = mergeFilters({ user_id: [1], entity: ["report"] }, { user_id: [2], entity: ["user"] });
    expect(merged.user_id).toEqual([-1]);
    expect(merged.entity).toEqual(["__nenhum__"]);
  });

  it("nao muda o objeto da pagina", () => {
    const page = { user_id: [1] };
    mergeFilters(page, { user_id: [2] });
    expect(page).toEqual({ user_id: [1] });
  });
});

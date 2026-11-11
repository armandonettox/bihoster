import { describe, expect, it } from "vitest";
import { GROUP_OPTIONS, METRIC_OPTIONS, TYPE_OPTIONS, defaultTitle, groupsFor } from "./widgetCatalog";

describe("widgetCatalog", () => {
  it("cartao so aceita total; linha so aceita series de tempo; rosca nao aceita dia nem hora", () => {
    expect(groupsFor("stat", "events")).toEqual(["none"]);
    expect(groupsFor("line", "events")).toEqual(["day", "hour", "weekday"]);
    expect(groupsFor("donut", "events")).not.toContain("day");
    expect(groupsFor("donut", "events")).not.toContain("hour");
    expect(groupsFor("bars", "events")).not.toContain("none");
    expect(groupsFor("table", "events")).not.toContain("none");
  });

  it("o metodo de login so existe para a medida Logins", () => {
    expect(groupsFor("bars", "logins")).toContain("login_method");
    expect(groupsFor("bars", "events")).not.toContain("login_method");
    expect(groupsFor("donut", "people")).not.toContain("login_method");
  });

  it("todo agrupamento listado tem nome, e todo tipo e medida tambem", () => {
    for (const group of Object.values({ a: groupsFor("bars", "logins"), b: groupsFor("line", "events") }).flat()) {
      expect(GROUP_OPTIONS.some((o) => o.value === group)).toBe(true);
    }
    expect(METRIC_OPTIONS).toHaveLength(8);
    expect(TYPE_OPTIONS.map((t) => t.value)).toEqual(["stat", "line", "bars", "donut", "table"]);
  });

  it("titulo padrao: so a medida no cartao e 'medida por agrupamento' nos demais", () => {
    expect(defaultTitle("events", "none")).toBe("Eventos");
    expect(defaultTitle("report_opens", "report")).toBe("Relatorios abertos por relatorio");
    expect(defaultTitle("logins", "login_method")).toBe("Logins por metodo de login");
    expect(defaultTitle("people", "day")).toBe("Pessoas ativas por dia");
  });
});

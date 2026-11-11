import { describe, expect, it } from "vitest";
import { periodRange, todayIn } from "./auditPeriod";

const custom = { from: "", to: "" };
// 02:00 UTC de 11/11 ainda e 10/11 em Sao Paulo
const now = new Date("2026-11-11T02:00:00Z");

describe("todayIn", () => {
  it("usa o dia do fuso informado, nao o do UTC", () => {
    expect(todayIn("America/Sao_Paulo", now)).toBe("2026-11-10");
    expect(todayIn("UTC", now)).toBe("2026-11-11");
  });
});

describe("periodRange", () => {
  it("hoje vale so o dia atual", () => {
    expect(periodRange("today", "America/Sao_Paulo", custom, now)).toEqual({ date_from: "2026-11-10", date_to: "2026-11-10" });
  });

  it("7 dias inclui hoje (7 dias no total)", () => {
    expect(periodRange("7d", "America/Sao_Paulo", custom, now)).toEqual({ date_from: "2026-11-04", date_to: "2026-11-10" });
  });

  it("30 e 90 dias atravessam o mes e o ano", () => {
    expect(periodRange("30d", "America/Sao_Paulo", custom, now)).toEqual({ date_from: "2026-10-12", date_to: "2026-11-10" });
    expect(periodRange("90d", "UTC", custom, new Date("2026-02-10T12:00:00Z"))).toEqual({
      date_from: "2025-11-13",
      date_to: "2026-02-10",
    });
  });

  it("tudo nao manda data", () => {
    expect(periodRange("all", "UTC", custom, now)).toEqual({});
  });

  it("personalizado usa as datas escolhidas e ignora campo vazio", () => {
    expect(periodRange("custom", "UTC", { from: "2026-01-01", to: "2026-01-31" }, now)).toEqual({
      date_from: "2026-01-01",
      date_to: "2026-01-31",
    });
    expect(periodRange("custom", "UTC", { from: "", to: "2026-01-31" }, now)).toEqual({
      date_from: undefined,
      date_to: "2026-01-31",
    });
  });
});

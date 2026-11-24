import { describe, expect, it } from "vitest";
import { SESSION_OPTIONS, formatDuration, sessionLabel } from "./tvTime";

describe("formatDuration", () => {
  it.each([
    [45, "45 s"],
    [60, "1 min"],
    [90, "1 min 30 s"],
    [600, "10 min"],
    [3661, "61 min 1 s"],
  ])("%i segundos viram %s", (segundos, texto) => {
    expect(formatDuration(segundos)).toBe(texto);
  });
});

describe("tempo de conexao", () => {
  it("o ultimo da lista e para sempre e so ele nao tem horas", () => {
    expect(SESSION_OPTIONS.filter((o) => o.hours === null).map((o) => o.label)).toEqual(["Para sempre"]);
    expect(SESSION_OPTIONS[SESSION_OPTIONS.length - 1].hours).toBeNull();
  });

  it("da nome as opcoes conhecidas e escreve em horas as demais", () => {
    expect(sessionLabel(24)).toBe("1 dia");
    expect(sessionLabel(null)).toBe("Para sempre");
    expect(sessionLabel(5)).toBe("5 horas");
    expect(sessionLabel(1)).toBe("1 hora");
  });
});

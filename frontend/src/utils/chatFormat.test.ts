import { describe, expect, it } from "vitest";
import { columnLabel, formatCell, formatUsd } from "./chatFormat";

describe("columnLabel", () => {
  it.each([
    ["Vendas[Valor]", "Valor"],
    ["[Total]", "Total"],
    ["'Vendas do mes'[Valor liquido]", "Valor liquido"],
    ["'D''Avila'[a]]b]", "a]b"],
    ["SemColchetes", "SemColchetes"],
    ["", ""],
  ])("%s vira %s", (entrada, esperado) => {
    expect(columnLabel(entrada)).toBe(esperado);
  });
});

describe("formatCell", () => {
  it("numero no padrao brasileiro", () => {
    expect(formatCell(1234.5)).toBe("1.234,5");
    expect(formatCell(0)).toBe("0");
    expect(formatCell(1234567)).toBe("1.234.567");
  });

  it("limita as casas decimais", () => {
    expect(formatCell(0.123456789)).toBe("0,1235");
  });

  it("vazio vira traco", () => {
    expect(formatCell(null)).toBe("-");
    expect(formatCell(undefined)).toBe("-");
  });

  it("booleano vira Sim e Nao", () => {
    expect(formatCell(true)).toBe("Sim");
    expect(formatCell(false)).toBe("Nao");
  });

  it("texto fica como veio, inclusive o que parece HTML", () => {
    expect(formatCell("Janeiro")).toBe("Janeiro");
    expect(formatCell("<b>x</b>")).toBe("<b>x</b>");
  });

  it("objeto vira JSON", () => {
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
  });
});

describe("formatUsd", () => {
  it("duas casas para valores normais", () => {
    expect(formatUsd(12.5)).toBe("US$ 12,50");
    expect(formatUsd(0)).toBe("US$ 0,00");
  });

  it("mais casas para valores pequenos", () => {
    expect(formatUsd(0.00004)).toBe("US$ 0,00004");
    expect(formatUsd(0.0012)).toBe("US$ 0,0012");
  });
});

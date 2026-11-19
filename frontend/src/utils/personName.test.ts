import { describe, expect, it } from "vitest";
import { formatPersonName } from "./personName";

describe("formatPersonName", () => {
  it("primeira letra de cada nome em maiúscula e o resto em minúscula", () => {
    expect(formatPersonName("ARMANDO NETTO")).toBe("Armando Netto");
    expect(formatPersonName("armando netto")).toBe("Armando Netto");
    expect(formatPersonName("aRmAnDo nEtTo")).toBe("Armando Netto");
  });

  it("palavras de ligação ficam em minúscula no meio do nome", () => {
    expect(formatPersonName("MARIA DA SILVA E SOUZA")).toBe("Maria da Silva e Souza");
    expect(formatPersonName("de Souza")).toBe("De Souza");
  });

  it("acentos, hífen e espaços sobrando", () => {
    expect(formatPersonName("  JOÃO   ÁVILA ")).toBe("João Ávila");
    expect(formatPersonName("ana-maria")).toBe("Ana-Maria");
  });

  it("texto vazio continua vazio", () => {
    expect(formatPersonName("")).toBe("");
  });
});

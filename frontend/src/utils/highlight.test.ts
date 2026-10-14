import { describe, expect, it } from "vitest";
import { getHighlightRanges } from "./highlight";

describe("getHighlightRanges", () => {
  it("destaca o trecho digitado, ignorando maiusculas", () => {
    expect(getHighlightRanges("Relatorio de Vendas", "vendas")).toEqual([[13, 19]]);
  });

  it("ignora acento nos dois lados e devolve a posicao no texto original", () => {
    expect(getHighlightRanges("Gestão de Contratos", "gestao")).toEqual([[0, 6]]);
    expect(getHighlightRanges("Gestao de Contratos", "gestão")).toEqual([[0, 6]]);
  });

  it("acento no meio do texto nao desloca as posicoes", () => {
    // "Coleção" tem 7 letras; "de" vem depois, na posicao 8
    expect(getHighlightRanges("Coleção de vendas", "de")).toEqual([[8, 10]]);
  });

  it("varias palavras que nao aparecem juntas destacam cada uma", () => {
    expect(getHighlightRanges("Vendas 2024 Norte", "norte vendas")).toEqual([
      [0, 6],
      [12, 17],
    ]);
  });

  it("palavras vizinhas separadas por espaco continuam sendo dois destaques", () => {
    expect(getHighlightRanges("Vendas Norte", "norte vendas")).toEqual([
      [0, 6],
      [7, 12],
    ]);
  });

  it("trechos que se sobrepoem viram um so", () => {
    // "vend" e "vendas" comecam no mesmo lugar: o destaque de "vend" ja esta dentro do de "vendas"
    expect(getHighlightRanges("Vendas", "vend vendas")).toEqual([[0, 6]]);
  });

  it("sem correspondencia ou consulta vazia nao destaca nada", () => {
    expect(getHighlightRanges("Vendas", "estoque")).toEqual([]);
    expect(getHighlightRanges("Vendas", "   ")).toEqual([]);
    expect(getHighlightRanges("", "vendas")).toEqual([]);
  });

  it("e literal: caracteres de regex nao viram padrao", () => {
    expect(getHighlightRanges("Vendas (2024)", "(2024)")).toEqual([[7, 13]]);
    expect(getHighlightRanges("Vendas", ".*")).toEqual([]);
  });

  it("emoji no nome nao desalinha o destaque", () => {
    const text = "📊 Vendas";
    const [[start, end]] = getHighlightRanges(text, "vendas");
    expect(text.slice(start, end)).toBe("Vendas");
  });
});

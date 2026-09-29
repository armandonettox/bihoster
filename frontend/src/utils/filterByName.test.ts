import { describe, expect, it } from "vitest";
import { filterByName, normalizeText } from "./filterByName";

const items = [
  { name: "Vendas por Região" },
  { name: "Estoque Central" },
  { name: "Financeiro - Coleção Mensal" },
  { name: "Vendas Online" },
];
const names = (list: { name: string }[]) => list.map((i) => i.name);
const by = (query: string) => names(filterByName(items, query, (i) => i.name));

describe("normalizeText", () => {
  it("ignora maiusculas e acentos", () => {
    expect(normalizeText("  Coleção  ")).toBe("colecao");
    expect(normalizeText("REGIÃO")).toBe("regiao");
  });
});

describe("filterByName", () => {
  it("consulta vazia devolve a mesma lista, sem copiar", () => {
    expect(filterByName(items, "", (i) => i.name)).toBe(items);
    expect(filterByName(items, "   ", (i) => i.name)).toBe(items);
  });

  it("acha por parte do nome, sem diferenciar maiuscula", () => {
    expect(by("estoque")).toEqual(["Estoque Central"]);
    expect(by("CENTRAL")).toEqual(["Estoque Central"]);
  });

  it("ignora acentos dos dois lados (digitar sem acento acha com acento e vice-versa)", () => {
    expect(by("colecao")).toEqual(["Financeiro - Coleção Mensal"]);
    expect(by("coleção")).toEqual(["Financeiro - Coleção Mensal"]);
    expect(by("regiao")).toEqual(["Vendas por Região"]);
  });

  it("varias palavras: todas precisam aparecer, em qualquer ordem", () => {
    expect(by("vendas online")).toEqual(["Vendas Online"]);
    expect(by("online vendas")).toEqual(["Vendas Online"]);
    expect(by("vendas")).toEqual(["Vendas por Região", "Vendas Online"]);
  });

  it("uma palavra que nao aparece elimina o item", () => {
    expect(by("vendas estoque")).toEqual([]);
  });

  it("sem resultado devolve lista vazia", () => {
    expect(by("zzz")).toEqual([]);
  });

  it("mantem a ordem original dos itens", () => {
    expect(by("o")).toEqual(names(items).filter((n) => normalizeText(n).includes("o")));
  });

  it("nao trata caracteres especiais de regex como padrao", () => {
    // Uma busca literal por "(" ou "." nao pode quebrar nem casar tudo
    expect(() => by("(")).not.toThrow();
    expect(by("(")).toEqual([]);
    expect(by(".*")).toEqual([]);
  });
});

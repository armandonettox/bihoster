import { describe, expect, it } from "vitest";
import { clampPage, DEFAULT_PAGE_SIZE, pageButtons, pageRange, PAGE_SIZE_OPTIONS, totalPages } from "./pagination";

describe("padrões", () => {
  it("20 linhas por página por padrão, com 10, 20, 50 e 100 para escolher", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(20);
    expect(PAGE_SIZE_OPTIONS).toEqual([10, 20, 50, 100]);
    expect(PAGE_SIZE_OPTIONS).toContain(DEFAULT_PAGE_SIZE);
  });
});

describe("totalPages", () => {
  it.each([
    [0, 20, 1],
    [1, 20, 1],
    [20, 20, 1],
    [21, 20, 2],
    [57, 20, 3],
    [100, 50, 2],
    [101, 50, 3],
  ])("%i linhas com %i por página são %i páginas", (total, size, esperado) => {
    expect(totalPages(total, size)).toBe(esperado);
  });

  it("nunca divide por zero", () => {
    expect(totalPages(10, 0)).toBe(10);
  });
});

describe("clampPage", () => {
  it("deixa a página como está quando ela existe", () => {
    expect(clampPage(2, 57, 20)).toBe(2);
  });

  it("volta para a última quando a página passou do fim (linhas apagadas)", () => {
    expect(clampPage(4, 57, 20)).toBe(3);
    expect(clampPage(9, 0, 20)).toBe(1);
  });

  it("nunca fica abaixo de 1", () => {
    expect(clampPage(0, 57, 20)).toBe(1);
    expect(clampPage(-3, 57, 20)).toBe(1);
  });
});

describe("pageRange", () => {
  it("mostra da primeira à última linha da página", () => {
    expect(pageRange(1, 57, 20)).toEqual({ first: 1, last: 20 });
    expect(pageRange(2, 57, 20)).toEqual({ first: 21, last: 40 });
  });

  it("a última página termina no total, não no tamanho da página", () => {
    expect(pageRange(3, 57, 20)).toEqual({ first: 41, last: 57 });
  });

  it("sem linhas é 0 a 0", () => {
    expect(pageRange(1, 0, 20)).toEqual({ first: 0, last: 0 });
  });
});

describe("pageButtons", () => {
  it("poucas páginas aparecem todas, sem reticências", () => {
    expect(pageButtons(1, 1)).toEqual([1]);
    expect(pageButtons(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageButtons(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("no começo de muitas páginas mostra o início, reticências e a última", () => {
    expect(pageButtons(1, 20)).toEqual([1, 2, 3, 4, "gap", 20]);
    expect(pageButtons(3, 20)).toEqual([1, 2, 3, 4, "gap", 20]);
  });

  it("no meio mostra a primeira, a atual com as vizinhas e a última, com reticências dos dois lados", () => {
    expect(pageButtons(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
  });

  it("no fim espelha o começo", () => {
    expect(pageButtons(20, 20)).toEqual([1, "gap", 17, 18, 19, 20]);
    expect(pageButtons(18, 20)).toEqual([1, "gap", 17, 18, 19, 20]);
  });

  it("não põe reticências entre páginas que já são vizinhas", () => {
    expect(pageButtons(5, 9)).toEqual([1, "gap", 4, 5, 6, "gap", 9]);
    expect(pageButtons(4, 8)).toEqual([1, 2, 3, 4, 5, "gap", 8]);
  });

  it("a página atual sempre está na lista e a primeira e a última também", () => {
    for (let pages = 1; pages <= 30; pages++) {
      for (let page = 1; page <= pages; page++) {
        const botoes = pageButtons(page, pages);
        expect(botoes).toContain(page);
        expect(botoes).toContain(1);
        expect(botoes).toContain(pages);
        const numeros = botoes.filter((b): b is number => b !== "gap");
        expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
      }
    }
  });
});

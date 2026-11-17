import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePagination } from "./usePagination";

const linhas = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("usePagination", () => {
  it("começa na primeira página com 20 linhas", () => {
    const { result } = renderHook(() => usePagination(linhas(57), ""));

    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(20);
    expect(result.current.pageItems).toEqual(linhas(20));
    expect(result.current.total).toBe(57);
  });

  it("trocar de página mostra as linhas daquela página, e a última é a que sobra", () => {
    const { result } = renderHook(() => usePagination(linhas(57), ""));

    act(() => result.current.setPage(2));
    expect(result.current.pageItems).toEqual(linhas(40).slice(20));

    act(() => result.current.setPage(3));
    expect(result.current.pageItems).toEqual(linhas(57).slice(40));
    expect(result.current.pageItems).toHaveLength(17);
  });

  it("uma página que não existe é trazida de volta para dentro do limite", () => {
    const { result } = renderHook(() => usePagination(linhas(57), ""));

    act(() => result.current.setPage(99));
    expect(result.current.page).toBe(3);

    act(() => result.current.setPage(-5));
    expect(result.current.page).toBe(1);
  });

  it("trocar a quantidade por página volta para a primeira página", () => {
    const { result } = renderHook(() => usePagination(linhas(120), ""));

    act(() => result.current.setPage(3));
    act(() => result.current.setPageSize(50));

    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(50);
    expect(result.current.pageItems).toHaveLength(50);
  });

  it("mudar a chave do filtro volta para a primeira página", () => {
    let chave = "";
    const { result, rerender } = renderHook(() => usePagination(linhas(57), chave));

    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);

    chave = "ana";
    rerender();

    expect(result.current.page).toBe(1);
  });

  it("com a mesma chave a página escolhida continua", () => {
    const { result, rerender } = renderHook(() => usePagination(linhas(57), "ana"));

    act(() => result.current.setPage(2));
    rerender();

    expect(result.current.page).toBe(2);
  });

  it("se as linhas diminuem e a página atual some, mostra a última que existe", () => {
    let itens = linhas(41);
    const { result, rerender } = renderHook(() => usePagination(itens, ""));

    act(() => result.current.setPage(3));
    expect(result.current.pageItems).toEqual([41]);

    itens = linhas(40);
    rerender();

    expect(result.current.page).toBe(2);
    expect(result.current.pageItems).toEqual(linhas(40).slice(20));
  });

  it("sem linhas não quebra: página 1 e lista vazia", () => {
    const { result } = renderHook(() => usePagination([], ""));

    expect(result.current.page).toBe(1);
    expect(result.current.pageItems).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it("aceita outra quantidade inicial por página", () => {
    const { result } = renderHook(() => usePagination(linhas(57), "", 10));

    expect(result.current.pageSize).toBe(10);
    expect(result.current.pageItems).toHaveLength(10);
  });
});

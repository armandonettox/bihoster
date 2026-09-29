import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ListFilter, { MIN_ITEMS_FOR_FILTER } from "./ListFilter";

function setup(props: Partial<Parameters<typeof ListFilter>[0]> = {}) {
  const onChange = vi.fn();
  const utils = render(<ListFilter value="" onChange={onChange} total={MIN_ITEMS_FOR_FILTER} {...props} />);
  return { onChange, ...utils };
}

describe("ListFilter", () => {
  it("nao aparece quando ha poucos itens (nao vale poluir a tela)", () => {
    const { container } = setup({ total: MIN_ITEMS_FOR_FILTER - 1 });
    expect(container.firstChild).toBeNull();
  });

  it("aparece a partir do minimo de itens", () => {
    setup({ total: MIN_ITEMS_FOR_FILTER });
    expect(screen.getByRole("searchbox", { name: "Filtrar por nome" })).toBeTruthy();
  });

  it("continua aparecendo se ha filtro ativo, mesmo com poucos itens (senao nao daria pra limpar)", () => {
    setup({ total: 1, value: "abc" });
    expect(screen.getByRole("searchbox", { name: "Filtrar por nome" })).toBeTruthy();
  });

  it("chama onChange ao digitar", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "vend" } });
    expect(onChange).toHaveBeenCalledWith("vend");
  });

  it("botao de limpar so existe com texto e zera o filtro", () => {
    const { onChange, rerender } = setup({ value: "" });
    expect(screen.queryByRole("button", { name: "Limpar filtro" })).toBeNull();

    rerender(<ListFilter value="vend" onChange={onChange} total={MIN_ITEMS_FOR_FILTER} />);
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtro" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("Esc dentro do campo limpa o filtro", () => {
    const { onChange } = setup({ value: "vend" });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("mostra quantos resultados sobraram quando ha filtro", () => {
    setup({ value: "vend", resultCount: 2 });
    expect(screen.getByText("2 de " + MIN_ITEMS_FOR_FILTER)).toBeTruthy();
  });
});

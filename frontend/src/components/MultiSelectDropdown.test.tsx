import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MultiSelectDropdown from "./MultiSelectDropdown";

const OPTIONS = [
  { value: "s1", label: "Visao geral" },
  { value: "s2", label: "Detalhes" },
  { value: "s3", label: "Resumo" },
];

function setup(props: Partial<Parameters<typeof MultiSelectDropdown>[0]> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <MultiSelectDropdown
      options={OPTIONS}
      selected={[]}
      onChange={onChange}
      placeholder="Relatorio inteiro"
      ariaLabel="Abas"
      {...props}
    />,
  );
  return { onChange, ...utils };
}

function openList() {
  fireEvent.click(screen.getByRole("button", { name: "Abas" }));
}

describe("MultiSelectDropdown", () => {
  it("comeca fechado e mostra o placeholder sem selecao", () => {
    setup();
    expect(screen.getByRole("button", { name: "Abas" }).textContent).toContain("Relatorio inteiro");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("abre a lista com uma caixinha por opcao", () => {
    setup();
    openList();
    expect(screen.getAllByRole("checkbox")).toHaveLength(OPTIONS.length);
  });

  it("marcar uma opcao devolve a selecao na ordem das opcoes, nao na ordem dos cliques", () => {
    const { onChange } = setup({ selected: ["s3"] });
    openList();
    fireEvent.click(screen.getByRole("checkbox", { name: "Visao geral" }));
    expect(onChange).toHaveBeenCalledWith(["s1", "s3"]);
  });

  it("desmarcar tira so aquela opcao", () => {
    const { onChange } = setup({ selected: ["s1", "s2"] });
    openList();
    fireEvent.click(screen.getByRole("checkbox", { name: "Visao geral" }));
    expect(onChange).toHaveBeenCalledWith(["s2"]);
  });

  it("mostra o nome quando ha uma so e a contagem quando ha varias", () => {
    const { rerender, onChange } = setup({ selected: ["s2"] });
    expect(screen.getByRole("button", { name: "Abas" }).textContent).toContain("Detalhes");

    rerender(
      <MultiSelectDropdown
        options={OPTIONS}
        selected={["s1", "s2"]}
        onChange={onChange}
        placeholder="Relatorio inteiro"
        ariaLabel="Abas"
      />,
    );
    expect(screen.getByRole("button", { name: "Abas" }).textContent).toContain("2 abas selecionadas");
  });

  it("Limpar selecao zera tudo e so aparece com algo marcado", () => {
    const { onChange, rerender } = setup({ selected: [] });
    openList();
    expect(screen.queryByRole("button", { name: "Limpar selecao" })).toBeNull();

    rerender(
      <MultiSelectDropdown
        options={OPTIONS}
        selected={["s1"]}
        onChange={onChange}
        placeholder="Relatorio inteiro"
        ariaLabel="Abas"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Limpar selecao" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("Esc fecha a lista sem deixar o evento subir (nao fecha o modal em volta)", () => {
    const onOuterKey = vi.fn();
    const { container } = render(
      <div onKeyDown={onOuterKey}>
        <MultiSelectDropdown options={OPTIONS} selected={[]} onChange={() => {}} placeholder="x" ariaLabel="Abas" />
      </div>,
    );
    fireEvent.click(container.querySelector("button")!);
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onOuterKey).not.toHaveBeenCalled();
  });

  it("clicar fora fecha a lista", () => {
    setup();
    openList();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("desabilitado nao abre", () => {
    setup({ disabled: true });
    openList();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

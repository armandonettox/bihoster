import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import MultiSelect from "./MultiSelect";

const OPTIONS = [
  { value: "1", label: "Ana Lima", hint: "ana@empresa.com" },
  { value: "2", label: "Bruno Sá", hint: "bruno@empresa.com" },
  { value: "3", label: "Carla Dias" },
];

/** Controlado como a tela de verdade controla: o pai guarda a selecao. */
function Harness({ onChange }: { onChange?: (v: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <MultiSelect
      label="Pessoa"
      options={OPTIONS}
      selected={selected}
      onChange={(next) => {
        setSelected(next);
        onChange?.(next);
      }}
    />
  );
}

const open = () => fireEvent.click(screen.getByRole("button", { name: /^Pessoa:/ }));

describe("MultiSelect", () => {
  it("fechado mostra so o nome do campo e 'Todas'; aberto lista as opcoes com caixa de marcar", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Pessoa: Todas" })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();

    open();

    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByText("ana@empresa.com")).toBeTruthy();
  });

  it("marca varias opcoes e o resumo mostra o nome (uma) ou a contagem (varias)", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    open();

    fireEvent.click(screen.getByRole("checkbox", { name: /Ana Lima/ }));
    expect(onChange).toHaveBeenLastCalledWith(["1"]);
    expect(screen.getByRole("button", { name: "Pessoa: Ana Lima" })).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: /Carla Dias/ }));
    expect(onChange).toHaveBeenLastCalledWith(["1", "3"]);
    expect(screen.getByRole("button", { name: "Pessoa: 2 selecionados" })).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: /Ana Lima/ }));
    expect(onChange).toHaveBeenLastCalledWith(["3"]);
  });

  it("a linha marcada ganha destaque e a caixa fica no inicio da linha, ao lado do texto", () => {
    const { container } = render(<Harness />);
    open();
    const ana = screen.getByRole("checkbox", { name: /Ana Lima/ });

    expect(container.querySelectorAll(".multiselect-option-selected")).toHaveLength(0);
    fireEvent.click(ana);

    const row = ana.closest("label") as HTMLElement;
    expect(row.className).toContain("multiselect-option-selected");
    // Caixa e texto na mesma linha: a caixa vem primeiro e o texto logo depois
    expect(row.firstElementChild).toBe(ana);
    expect(row.lastElementChild?.className).toContain("multiselect-option-text");
    expect(container.querySelectorAll(".multiselect-option-selected")).toHaveLength(1);
  });

  it("a pesquisa filtra por nome ou email, sem diferenciar maiuscula nem acento", () => {
    render(<Harness />);
    open();
    const search = screen.getByLabelText("Pesquisar em Pessoa");

    fireEvent.change(search, { target: { value: "NO SA" } }); // acha "Bruno Sá": maiuscula e acento nao contam
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /Bruno/ })).toBeTruthy();

    fireEvent.change(search, { target: { value: "ANA@EMPRESA" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /Ana Lima/ })).toBeTruthy();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Nenhum resultado")).toBeTruthy();
  });

  it("'Marcar resultados' marca so o que a busca mostra e mantem o que ja estava marcado", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    open();
    fireEvent.click(screen.getByRole("checkbox", { name: /Carla Dias/ }));

    fireEvent.change(screen.getByLabelText("Pesquisar em Pessoa"), { target: { value: "empresa" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar resultados" }));

    expect(onChange).toHaveBeenLastCalledWith(["3", "1", "2"]);
    // Tudo que aparece esta marcado: o botao vira Desmarcar
    fireEvent.click(screen.getByRole("button", { name: "Desmarcar" }));
    expect(onChange).toHaveBeenLastCalledWith(["3"]);
  });

  it("Marcar todos e Limpar", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    open();

    fireEvent.click(screen.getByRole("button", { name: "Marcar todos" }));
    expect(onChange).toHaveBeenLastCalledWith(["1", "2", "3"]);

    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole("button", { name: "Pessoa: Todas" })).toBeTruthy();
  });

  it("Esc e clique fora fecham, e a busca recomeca limpa na proxima abertura", () => {
    render(<Harness />);
    open();
    fireEvent.change(screen.getByLabelText("Pesquisar em Pessoa"), { target: { value: "ana" } });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("checkbox")).toBeNull();

    open();
    expect((screen.getByLabelText("Pesquisar em Pessoa") as HTMLInputElement).value).toBe("");
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

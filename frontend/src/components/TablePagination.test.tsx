import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TablePagination from "./TablePagination";

const onPageChange = vi.fn();
const onPageSizeChange = vi.fn();

function abrir(props: Partial<Parameters<typeof TablePagination>[0]> = {}) {
  return render(
    <TablePagination
      total={57}
      page={1}
      pageSize={20}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      {...props}
    />,
  );
}

const navegacao = () => screen.getByRole("navigation", { name: "Paginação" });

beforeEach(() => {
  onPageChange.mockClear();
  onPageSizeChange.mockClear();
});

describe("TablePagination", () => {
  it("mostra quais linhas estão na tela e o total", () => {
    abrir();

    expect(screen.getByRole("status").textContent).toBe("1-20 de 57");
  });

  it("na última página o intervalo termina no total", () => {
    abrir({ page: 3 });

    expect(screen.getByRole("status").textContent).toBe("41-57 de 57");
  });

  it("a quantidade por página tem 10, 20, 50 e 100, e a atual vem marcada", () => {
    abrir();

    const seletor = screen.getByLabelText("Linhas por página") as HTMLSelectElement;
    expect(Array.from(seletor.options).map((o) => o.value)).toEqual(["10", "20", "50", "100"]);
    expect(seletor.value).toBe("20");
  });

  it("escolher outra quantidade avisa com o número", () => {
    abrir();

    fireEvent.change(screen.getByLabelText("Linhas por página"), { target: { value: "50" } });

    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("uma quantidade que não está na lista aparece mesmo assim", () => {
    abrir({ pageSize: 25 });

    const seletor = screen.getByLabelText("Linhas por página") as HTMLSelectElement;
    expect(Array.from(seletor.options).map((o) => o.value)).toEqual(["10", "20", "25", "50", "100"]);
    expect(seletor.value).toBe("25");
  });

  it("os botões de página mostram a atual como marcada e clicar em outra avisa o número", () => {
    abrir({ page: 2 });

    const atual = within(navegacao()).getByRole("button", { name: "Página 2" });
    expect(atual.getAttribute("aria-current")).toBe("page");
    expect(within(navegacao()).getByRole("button", { name: "Página 1" }).getAttribute("aria-current")).toBeNull();

    fireEvent.click(within(navegacao()).getByRole("button", { name: "Página 3" }));

    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("Próxima e Anterior andam uma página", () => {
    abrir({ page: 2 });

    fireEvent.click(screen.getByText("Próxima"));
    fireEvent.click(screen.getByText("Anterior"));

    expect(onPageChange).toHaveBeenNthCalledWith(1, 3);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 1);
  });

  it("na primeira página o Anterior fica desligado, e na última a Próxima", () => {
    const { unmount } = abrir({ page: 1 });
    expect((screen.getByText("Anterior") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Próxima") as HTMLButtonElement).disabled).toBe(false);
    unmount();

    abrir({ page: 3 });
    expect((screen.getByText("Anterior") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText("Próxima") as HTMLButtonElement).disabled).toBe(true);
  });

  it("com uma página só os dois ficam desligados e só existe o botão 1", () => {
    abrir({ total: 5 });

    expect((screen.getByText("Anterior") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Próxima") as HTMLButtonElement).disabled).toBe(true);
    expect(within(navegacao()).getAllByRole("button", { name: /^Página/ })).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("1-5 de 5");
  });

  it("com muitas páginas usa reticências em vez de listar todas", () => {
    abrir({ total: 400, page: 10 });

    const botoes = within(navegacao()).getAllByRole("button", { name: /^Página/ });
    expect(botoes.map((b) => b.textContent)).toEqual(["1", "9", "10", "11", "20"]);
    expect(navegacao().textContent).toContain("…");
  });

  it("clicar na página que já está aberta também avisa, sem quebrar", () => {
    abrir({ page: 2 });

    fireEvent.click(within(navegacao()).getByRole("button", { name: "Página 2" }));

    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReorderButtons from "./ReorderButtons";

afterEach(cleanup);

function setup(props: Partial<Parameters<typeof ReorderButtons>[0]> = {}) {
  const onMove = vi.fn();
  render(<ReorderButtons name="Vendas" canMoveUp canMoveDown onMove={onMove} {...props} />);
  return {
    onMove,
    up: screen.getByRole("button", { name: "Mover Vendas para cima" }) as HTMLButtonElement,
    down: screen.getByRole("button", { name: "Mover Vendas para baixo" }) as HTMLButtonElement,
  };
}

describe("ReorderButtons", () => {
  it("chama onMove com a direcao certa", () => {
    const { onMove, up, down } = setup();
    fireEvent.click(up);
    fireEvent.click(down);
    expect(onMove.mock.calls).toEqual([["up"], ["down"]]);
  });

  it("desabilita subir quando ja e o primeiro", () => {
    const { onMove, up, down } = setup({ canMoveUp: false });
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(false);
    fireEvent.click(up);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("desabilita descer quando ja e o ultimo", () => {
    const { onMove, up, down } = setup({ canMoveDown: false });
    expect(down.disabled).toBe(true);
    expect(up.disabled).toBe(false);
    fireEvent.click(down);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("desabilita os dois enquanto uma movimentacao esta em andamento (evita clique duplo)", () => {
    const { onMove, up, down } = setup({ busy: true });
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(true);
    fireEvent.click(up);
    fireEvent.click(down);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("o clique nao sobe para o card (que abre o relatorio em tela cheia)", () => {
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <ReorderButtons name="Vendas" canMoveUp canMoveDown onMove={vi.fn()} />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mover Vendas para baixo" }));

    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("o nome do relatorio fica no rotulo, pra leitor de tela distinguir os botoes de cada card", () => {
    cleanup();
    render(
      <>
        <ReorderButtons name="Vendas" canMoveUp canMoveDown onMove={vi.fn()} />
        <ReorderButtons name="Estoque" canMoveUp canMoveDown onMove={vi.fn()} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Mover Vendas para cima" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mover Estoque para cima" })).toBeTruthy();
  });
});

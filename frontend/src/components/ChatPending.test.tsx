import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatPending from "./ChatPending";

const PENDING_STEPS = ["Escolhendo o relatorio", "Montando a consulta", "Lendo os dados", "Escrevendo a resposta"];
const PENDING_STEP_MS = 4000;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ChatPending", () => {
  it("comeca na primeira frase e avisa os leitores de tela com role status", () => {
    render(<ChatPending />);

    expect(screen.getByRole("status").textContent).toBe(PENDING_STEPS[0]);
  });

  it("troca de frase a cada intervalo e para na ultima ate a resposta chegar", () => {
    render(<ChatPending />);

    PENDING_STEPS.slice(1).forEach((frase) => {
      act(() => {
        vi.advanceTimersByTime(PENDING_STEP_MS);
      });
      expect(screen.getByRole("status").textContent).toBe(frase);
    });

    act(() => {
      vi.advanceTimersByTime(PENDING_STEP_MS * 5);
    });
    expect(screen.getByRole("status").textContent).toBe(PENDING_STEPS[PENDING_STEPS.length - 1]);
  });

  it("os pontinhos ficam escondidos dos leitores de tela", () => {
    const { container } = render(<ChatPending />);

    expect(container.querySelector(".chat-dots")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll(".chat-dots span").length).toBe(3);
  });

  it("para o relogio quando sai da tela", () => {
    const { unmount } = render(<ChatPending />);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});

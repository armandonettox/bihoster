import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SlideshowControls from "./SlideshowControls";
import SlideshowProgress from "./SlideshowProgress";

function setup(props: Partial<Parameters<typeof SlideshowControls>[0]> = {}) {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const onTogglePause = vi.fn();
  render(
    <SlideshowControls index={0} count={3} onPrev={onPrev} onNext={onNext} onTogglePause={onTogglePause} {...props} />,
  );
  return { onPrev, onNext, onTogglePause };
}

describe("SlideshowControls", () => {
  it("mostra a posicao (1 / 3) e os botoes", () => {
    setup({ index: 1 });
    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Relatorio anterior" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Proximo relatorio" })).toBeTruthy();
  });

  it("os botoes chamam os callbacks", () => {
    const { onPrev, onNext, onTogglePause } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Relatorio anterior" }));
    fireEvent.click(screen.getByRole("button", { name: "Proximo relatorio" }));
    fireEvent.click(screen.getByRole("button", { name: "Pausar exibicao" }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onTogglePause).toHaveBeenCalledTimes(1);
  });

  it("o botao de pausa vira 'Retomar' quando esta pausado", () => {
    setup({ paused: true });
    expect(screen.getByRole("button", { name: "Retomar exibicao" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pausar exibicao" })).toBeNull();
  });

  it("sem onTogglePause (Apresentacao) nao mostra o botao de pausa", () => {
    setup({ onTogglePause: undefined });
    expect(screen.queryByRole("button", { name: /exibicao/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Proximo relatorio" })).toBeTruthy();
  });

  it("com um relatorio so, mostra a posicao mas nao os botoes", () => {
    setup({ count: 1 });
    expect(screen.getByText("1 / 1")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("SlideshowProgress", () => {
  const countdown = { key: 1, durationMs: 6000, from: 0.4 };

  function bar() {
    return document.querySelector(".slideshow-progress-bar") as HTMLElement;
  }

  it("passa a duracao e o ponto de partida pro CSS", () => {
    render(<SlideshowProgress countdown={countdown} paused={false} />);
    expect(bar().style.getPropertyValue("--duration")).toBe("6000ms");
    expect(bar().style.getPropertyValue("--from")).toBe("0.4");
    expect(bar().style.animationPlayState).toBe("running");
  });

  it("congela a barra quando pausado", () => {
    render(<SlideshowProgress countdown={countdown} paused />);
    expect(bar().style.animationPlayState).toBe("paused");
  });

  it("reinicia a barra (novo elemento) quando a chave da contagem muda", () => {
    const { rerender } = render(<SlideshowProgress countdown={countdown} paused={false} />);
    const before = bar();
    rerender(<SlideshowProgress countdown={{ ...countdown, key: 2 }} paused={false} />);
    expect(bar()).not.toBe(before);
  });

  it("nao reinicia a barra quando so o estado de pausa muda", () => {
    const { rerender } = render(<SlideshowProgress countdown={countdown} paused={false} />);
    const before = bar();
    rerender(<SlideshowProgress countdown={countdown} paused />);
    expect(bar()).toBe(before);
  });

  it("e decorativa pra leitor de tela", () => {
    render(<SlideshowProgress countdown={countdown} paused={false} />);
    expect(document.querySelector(".slideshow-progress")?.getAttribute("aria-hidden")).toBe("true");
  });
});

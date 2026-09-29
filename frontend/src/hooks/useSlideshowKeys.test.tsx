import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSlideshowKeys } from "./useSlideshowKeys";

afterEach(() => {
  document.body.innerHTML = "";
});

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function setup(withPause = true) {
  const onNext = vi.fn();
  const onPrev = vi.fn();
  const onTogglePause = vi.fn();
  const hook = renderHook(() =>
    useSlideshowKeys({ onNext, onPrev, onTogglePause: withPause ? onTogglePause : undefined }),
  );
  return { onNext, onPrev, onTogglePause, ...hook };
}

describe("useSlideshowKeys", () => {
  it("seta direita avanca e seta esquerda volta", () => {
    const { onNext, onPrev } = setup();
    press("ArrowRight");
    press("ArrowLeft");
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("espaco pausa/retoma e nao rola a pagina", () => {
    const { onTogglePause } = setup();
    const event = press(" ");
    expect(onTogglePause).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("sem onTogglePause (apresentacao), espaco nao faz nada e nao e interceptado", () => {
    const { onNext, onPrev } = setup(false);
    const event = press(" ");
    expect(event.defaultPrevented).toBe(false);
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
  });

  it("ignora as teclas quando o foco esta num campo de texto", () => {
    const { onNext, onTogglePause } = setup();
    const input = document.createElement("input");
    document.body.appendChild(input);

    press("ArrowRight", {}, input);
    const space = press(" ", {}, input);

    expect(onNext).not.toHaveBeenCalled();
    expect(onTogglePause).not.toHaveBeenCalled();
    expect(space.defaultPrevented).toBe(false);
  });

  it("ignora quando ha modificador (Ctrl/Alt/Meta), pra nao brigar com atalhos do navegador", () => {
    const { onNext, onPrev } = setup();
    press("ArrowRight", { ctrlKey: true });
    press("ArrowLeft", { altKey: true });
    press("ArrowRight", { metaKey: true });
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
  });

  it("outras teclas nao fazem nada", () => {
    const { onNext, onPrev, onTogglePause } = setup();
    press("a");
    press("Enter");
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
    expect(onTogglePause).not.toHaveBeenCalled();
  });

  it("para de escutar quando o componente sai da tela", () => {
    const { onNext, unmount } = setup();
    unmount();
    press("ArrowRight");
    expect(onNext).not.toHaveBeenCalled();
  });

  it("usa sempre os callbacks mais recentes, sem reinscrever o listener a cada render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSlideshowKeys({ onNext: cb, onPrev: vi.fn() }), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });

    press("ArrowRight");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LazyMount from "./LazyMount";

// O jsdom nao tem IntersectionObserver: este guarda os observadores pra o teste "rolar a pagina"
type Callback = (entries: { isIntersecting: boolean }[]) => void;
const observadores: { callback: Callback; disconnect: ReturnType<typeof vi.fn> }[] = [];

class FakeIntersectionObserver {
  disconnect = vi.fn();
  constructor(callback: Callback) {
    observadores.push({ callback, disconnect: this.disconnect });
  }
  observe() {}
  unobserve() {}
}

function ultimo() {
  return observadores[observadores.length - 1];
}

function aparece() {
  act(() => ultimo().callback([{ isIntersecting: true }]));
}

function sai() {
  act(() => ultimo().callback([{ isIntersecting: false }]));
}

beforeEach(() => {
  observadores.length = 0;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderizar(props: { unmountWhenHidden?: boolean } = {}) {
  return render(
    <LazyMount placeholder={<span>carregando</span>} {...props}>
      <span>conteudo</span>
    </LazyMount>,
  );
}

describe("LazyMount - padrao", () => {
  it("mostra o placeholder ate o elemento aparecer e depois monta na hora", () => {
    renderizar();
    expect(screen.getByText("carregando")).toBeTruthy();

    aparece();

    expect(screen.getByText("conteudo")).toBeTruthy();
  });

  it("depois de montado continua montado mesmo que saia da tela", () => {
    renderizar();
    aparece();

    // Nao ha mais observador ativo: o conteudo nao e desmontado
    expect(screen.getByText("conteudo")).toBeTruthy();
    expect(ultimo().disconnect).toHaveBeenCalled();
  });
});

describe("LazyMount - unmountWhenHidden", () => {
  it("so monta depois de ficar visivel um instante", () => {
    renderizar({ unmountWhenHidden: true });

    aparece();
    expect(screen.queryByText("conteudo")).toBeNull();

    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByText("conteudo")).toBeTruthy();
  });

  it("rolagem rapida: o que so passou pela tela nao chega a montar", () => {
    renderizar({ unmountWhenHidden: true });

    aparece();
    act(() => vi.advanceTimersByTime(50));
    sai();
    act(() => vi.advanceTimersByTime(1000));

    expect(screen.queryByText("conteudo")).toBeNull();
    expect(screen.getByText("carregando")).toBeTruthy();
  });

  it("desmonta depois de ficar fora da tela por um tempo", () => {
    renderizar({ unmountWhenHidden: true });
    aparece();
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByText("conteudo")).toBeTruthy();

    sai();
    act(() => vi.advanceTimersByTime(1900));
    expect(screen.getByText("conteudo")).toBeTruthy(); // ainda dentro da folga

    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("conteudo")).toBeNull();
    expect(screen.getByText("carregando")).toBeTruthy();
  });

  it("voltar pra tela antes do tempo cancela a desmontagem", () => {
    renderizar({ unmountWhenHidden: true });
    aparece();
    act(() => vi.advanceTimersByTime(150));

    sai();
    act(() => vi.advanceTimersByTime(1000));
    aparece();
    act(() => vi.advanceTimersByTime(5000));

    expect(screen.getByText("conteudo")).toBeTruthy();
  });

  it("monta de novo quando volta a aparecer depois de desmontado", () => {
    renderizar({ unmountWhenHidden: true });
    aparece();
    act(() => vi.advanceTimersByTime(150));
    sai();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByText("conteudo")).toBeNull();

    aparece();
    act(() => vi.advanceTimersByTime(150));

    expect(screen.getByText("conteudo")).toBeTruthy();
  });

  it("ao sair da pagina solta o observador e os temporizadores", () => {
    const { unmount } = renderizar({ unmountWhenHidden: true });
    const observador = ultimo();
    aparece();

    unmount();

    expect(observador.disconnect).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

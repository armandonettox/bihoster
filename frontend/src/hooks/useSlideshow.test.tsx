import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSlideshow } from "./useSlideshow";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(props: { count?: number; intervalMs?: number; autoAdvance?: boolean } = {}) {
  return renderHook((p) => useSlideshow({ count: 3, intervalMs: 10_000, autoAdvance: true, ...p }), {
    initialProps: props,
  });
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("avanco automatico", () => {
  it("troca de slide a cada intervalo", () => {
    const { result } = setup();
    expect(result.current.index).toBe(0);
    advance(10_000);
    expect(result.current.index).toBe(1);
    advance(10_000);
    expect(result.current.index).toBe(2);
  });

  it("volta ao primeiro depois do ultimo", () => {
    const { result } = setup({ count: 2 });
    advance(10_000);
    advance(10_000);
    expect(result.current.index).toBe(0);
  });

  it("nao avanca antes de completar o intervalo", () => {
    const { result } = setup();
    advance(9_999);
    expect(result.current.index).toBe(0);
  });

  it("com um slide so, nao avanca", () => {
    const { result } = setup({ count: 1 });
    advance(60_000);
    expect(result.current.index).toBe(0);
  });

  it("com autoAdvance desligado (apresentacao), nao avanca sozinho", () => {
    const { result } = setup({ autoAdvance: false });
    advance(60_000);
    expect(result.current.index).toBe(0);
  });
});

describe("pausa", () => {
  it("pausado nao avanca", () => {
    const { result } = setup();
    act(() => result.current.togglePause());
    expect(result.current.paused).toBe(true);
    advance(60_000);
    expect(result.current.index).toBe(0);
  });

  it("ao retomar, continua do tempo que faltava (nao recomeca do zero)", () => {
    const { result } = setup();
    advance(3_000); // faltam 7s
    act(() => result.current.togglePause());
    advance(30_000); // tempo parado nao conta
    act(() => result.current.togglePause());
    expect(result.current.paused).toBe(false);

    advance(6_999);
    expect(result.current.index).toBe(0);
    advance(1);
    expect(result.current.index).toBe(1);
  });

  it("depois de retomar e avancar, o slide seguinte tem o intervalo cheio", () => {
    const { result } = setup();
    advance(3_000);
    act(() => result.current.togglePause());
    act(() => result.current.togglePause());
    advance(7_000); // avanca pro slide 1
    expect(result.current.index).toBe(1);

    advance(9_999);
    expect(result.current.index).toBe(1);
    advance(1);
    expect(result.current.index).toBe(2);
  });
});

describe("navegacao manual", () => {
  it("next e prev mudam o slide", () => {
    const { result } = setup();
    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    act(() => result.current.prev());
    expect(result.current.index).toBe(0);
  });

  it("prev do primeiro vai pro ultimo, next do ultimo vai pro primeiro", () => {
    const { result } = setup();
    act(() => result.current.prev());
    expect(result.current.index).toBe(2);
    act(() => result.current.next());
    expect(result.current.index).toBe(0);
  });

  it("navegar manualmente reinicia a contagem: o slide novo tem o intervalo cheio", () => {
    const { result } = setup();
    advance(9_000); // quase trocando
    act(() => result.current.next()); // usuario troca antes
    expect(result.current.index).toBe(1);

    // Sem reiniciar, o slide 1 trocaria em 1s (pelo relogio antigo)
    advance(1_000);
    expect(result.current.index).toBe(1);
    advance(9_000);
    expect(result.current.index).toBe(2);
  });

  it("navegar com a exibicao pausada muda o slide e continua pausado", () => {
    const { result } = setup();
    act(() => result.current.togglePause());
    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    expect(result.current.paused).toBe(true);
    advance(60_000);
    expect(result.current.index).toBe(1);
  });

  it("funciona sem avanco automatico (apresentacao)", () => {
    const { result } = setup({ autoAdvance: false });
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.index).toBe(2);
  });

  it("com um slide so, next e prev ficam no mesmo lugar", () => {
    const { result } = setup({ count: 1 });
    act(() => result.current.next());
    act(() => result.current.prev());
    expect(result.current.index).toBe(0);
  });
});

describe("lista mudando", () => {
  it("se a lista encolhe abaixo do indice atual, volta ao inicio", () => {
    const { result, rerender } = setup({ count: 3 });
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.index).toBe(2);

    rerender({ count: 2 });

    expect(result.current.index).toBe(0);
  });

  it("mudar o intervalo passa a valer no proximo slide", () => {
    const { result, rerender } = setup({ intervalMs: 10_000 });
    rerender({ intervalMs: 5_000 });
    advance(5_000);
    expect(result.current.index).toBe(1);
  });
});

describe("contagem exposta pra barra de progresso", () => {
  it("comeca do zero com a duracao cheia", () => {
    const { result } = setup();
    expect(result.current.countdown.durationMs).toBe(10_000);
    expect(result.current.countdown.from).toBe(0);
  });

  it("muda de chave a cada slide (pra a barra reiniciar)", () => {
    const { result } = setup();
    const first = result.current.countdown.key;
    advance(10_000);
    expect(result.current.countdown.key).not.toBe(first);
  });

  it("ao retomar, a barra continua de onde parou (from) pelo tempo que resta", () => {
    const { result } = setup();
    advance(4_000); // 40% percorrido, faltam 6s
    act(() => result.current.togglePause());
    act(() => result.current.togglePause());

    expect(result.current.countdown.durationMs).toBe(6_000);
    expect(result.current.countdown.from).toBeCloseTo(0.4, 5);
  });
});

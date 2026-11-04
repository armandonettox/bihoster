import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmbedTimer, isEmbedTimingEnabled } from "./embedTiming";

/** Relogio de mentira: cada chamada devolve o proximo valor da lista */
function relogio(valores: number[]) {
  const fila = [...valores];
  return () => fila.shift() ?? valores[valores.length - 1];
}

beforeEach(() => {
  window.localStorage.clear();
  window.__bihosterEmbed = undefined;
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createEmbedTimer", () => {
  it("calcula o tempo de cada etapa a partir dos instantes marcados", () => {
    // inicio=1000, config=1120, embed=1130, loaded=1830, rendered=2430
    const timer = createEmbedTimer(7, { enabled: false, now: relogio([1000, 1120, 1130, 1830, 2430]) });
    timer.mark("config");
    timer.mark("embed");
    timer.mark("loaded");
    timer.mark("rendered");

    const linha = timer.finish();

    expect(linha).toEqual({
      relatorio: 7,
      config_ms: 120,
      embed_ate_carregar_ms: 700,
      carregar_ate_desenhar_ms: 600,
      total_ms: 1430,
      erro: false,
      pre_carregado: false,
    });
  });

  it("etapa que nao aconteceu fica nula, em vez de inventar um tempo", () => {
    const timer = createEmbedTimer(7, { enabled: false, now: relogio([0, 100]) });
    timer.mark("config");

    const linha = timer.finish(true);

    expect(linha).toMatchObject({ config_ms: 100, embed_ate_carregar_ms: null, total_ms: null, erro: true });
  });

  it("so conta a primeira vez de cada etapa", () => {
    const timer = createEmbedTimer(7, { enabled: false, now: relogio([0, 50, 90]) });
    timer.mark("config");
    timer.mark("config");

    expect(timer.finish()?.config_ms).toBe(50);
  });

  it("registra o fim uma vez so", () => {
    const timer = createEmbedTimer(7, { enabled: false, now: relogio([0, 10]) });

    expect(timer.finish()).not.toBeNull();
    expect(timer.finish()).toBeNull();
  });

  it("guarda se a pre-carga do Power BI tinha sido iniciada", () => {
    const timer = createEmbedTimer(7, { enabled: false, preloaded: true, now: relogio([0]) });

    expect(timer.finish()?.pre_carregado).toBe(true);
  });

  it("com a medicao ligada escreve no console e em window.__bihosterEmbed", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const timer = createEmbedTimer(7, { enabled: true, now: relogio([0, 30]) });
    timer.mark("config");

    timer.finish();

    expect(info).toHaveBeenCalledTimes(1);
    expect(window.__bihosterEmbed).toHaveLength(1);
    expect(window.__bihosterEmbed?.[0].relatorio).toBe(7);
  });

  it("com a medicao desligada nao escreve nada", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const timer = createEmbedTimer(7, { enabled: false, now: relogio([0, 30]) });

    timer.finish();

    expect(info).not.toHaveBeenCalled();
    expect(window.__bihosterEmbed).toBeUndefined();
  });
});

describe("isEmbedTimingEnabled", () => {
  it("vem desligada por padrao", () => {
    expect(isEmbedTimingEnabled()).toBe(false);
  });

  it("?debug=embed liga e continua ligada nas proximas paginas", () => {
    window.history.replaceState({}, "", "/?debug=embed");
    expect(isEmbedTimingEnabled()).toBe(true);

    window.history.replaceState({}, "", "/collection");
    expect(isEmbedTimingEnabled()).toBe(true);
  });

  it("?debug=off desliga", () => {
    window.history.replaceState({}, "", "/?debug=embed");
    isEmbedTimingEnabled();

    window.history.replaceState({}, "", "/?debug=off");

    expect(isEmbedTimingEnabled()).toBe(false);
  });
});

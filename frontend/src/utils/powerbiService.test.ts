import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O SDK de verdade fala com iframes; aqui basta saber como o modulo o usa
const sdk = vi.hoisted(() => {
  const preload = vi.fn();
  const instances: unknown[] = [];
  class Service {
    preload = preload;
    constructor() {
      instances.push(this);
    }
  }
  return { preload, instances, Service };
});

vi.mock("powerbi-client", () => ({
  service: { Service: sdk.Service },
  factories: { hpmFactory: {}, wpmpFactory: {}, routerFactory: {} },
  models: {},
}));

import { getPowerBiService, isPreloadStarted, preloadPowerBi, resetPowerBiServiceForTests } from "./powerbiService";

function iframeDeMentira() {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  return frame;
}

beforeEach(() => {
  resetPowerBiServiceForTests();
  sdk.instances.length = 0;
  sdk.preload.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("getPowerBiService", () => {
  it("cria o servico uma vez so e devolve o mesmo para todos os embeds", () => {
    const a = getPowerBiService();
    const b = getPowerBiService();

    expect(a).toBe(b);
    expect(sdk.instances).toHaveLength(1);
  });
});

describe("preloadPowerBi", () => {
  it("inicia a pre-carga uma vez por pagina", () => {
    sdk.preload.mockReturnValue(iframeDeMentira());

    expect(preloadPowerBi()).toBe(true);
    expect(preloadPowerBi()).toBe(false);

    expect(sdk.preload).toHaveBeenCalledTimes(1);
    expect(sdk.preload.mock.calls[0][0]).toMatchObject({ type: "report", embedUrl: expect.stringContaining("powerbi.com") });
    expect(isPreloadStarted()).toBe(true);
  });

  it("remove o iframe escondido depois que a pre-carga termina", () => {
    const frame = iframeDeMentira();
    sdk.preload.mockReturnValue(frame);
    preloadPowerBi();

    frame.dispatchEvent(new Event("preloaded"));
    expect(document.body.contains(frame)).toBe(true); // ainda espera os recursos chegarem
    vi.advanceTimersByTime(5000);

    expect(document.body.contains(frame)).toBe(false);
  });

  it("remove o iframe mesmo que a pre-carga nunca avise que terminou", () => {
    const frame = iframeDeMentira();
    sdk.preload.mockReturnValue(frame);
    preloadPowerBi();

    vi.advanceTimersByTime(20000);

    expect(document.body.contains(frame)).toBe(false);
  });

  it("se o SDK falhar, nao quebra a pagina", () => {
    sdk.preload.mockImplementation(() => {
      throw new Error("invalid embed url");
    });

    expect(preloadPowerBi()).toBe(false);
  });
});

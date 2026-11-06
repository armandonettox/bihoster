import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as reportsApi from "../api/reports";
import type { EmbedConfig } from "../api/reports";
import ReportEmbed from "./ReportEmbed";

const mocks = vi.hoisted(() => {
  const handlers: Record<string, () => unknown> = {};
  const embedded = {
    on: vi.fn((name: string, handler: () => unknown) => {
      handlers[name] = handler;
    }),
    getPages: vi.fn().mockResolvedValue([]),
    updateSettings: vi.fn(),
    setAccessToken: vi.fn(),
    setPage: vi.fn(),
    getActivePage: vi.fn(),
  };
  const service = { embed: vi.fn(() => embedded), reset: vi.fn() };
  return { handlers, embedded, service };
});

vi.mock("powerbi-client", () => ({ models: { TokenType: { Embed: 1 }, BackgroundType: { Transparent: 0 } } }));
vi.mock("../utils/powerbiService", () => ({
  getPowerBiService: () => mocks.service,
  isPreloadStarted: () => true,
}));
vi.mock("../context/WorkspaceContext", () => ({ useWorkspace: () => ({ currentWorkspace: { id: 3 } }) }));
vi.mock("../api/reports", () => ({ getEmbedConfig: vi.fn() }));

const getEmbedConfig = vi.mocked(reportsApi.getEmbedConfig);

const CONFIG: EmbedConfig = {
  report_id: "pbi-rel",
  embed_url: "https://app.powerbi.com/reportEmbed?reportId=pbi-rel",
  access_token: "token-de-teste",
  page_name: null,
  page_names: [],
  expires_at: null,
  show_filter_pane: false,
  show_page_nav: true,
};

beforeEach(() => {
  for (const chave of Object.keys(mocks.handlers)) delete mocks.handlers[chave];
  mocks.service.embed.mockClear();
  mocks.service.reset.mockClear();
  mocks.embedded.on.mockClear();
  window.localStorage.clear();
  window.__bihosterEmbed = undefined;
  getEmbedConfig.mockResolvedValue(CONFIG);
});

describe("ReportEmbed", () => {
  it("busca a configuracao da colecao e abre o relatorio no servico compartilhado", async () => {
    render(<ReportEmbed reportId={34} />);

    await waitFor(() => expect(mocks.service.embed).toHaveBeenCalledTimes(1));

    expect(getEmbedConfig).toHaveBeenCalledWith(3, 34);
    const [container, config] = mocks.service.embed.mock.calls[0] as unknown as [HTMLElement, Record<string, unknown>];
    expect(container.className).toContain("report-embed-frame");
    expect(config).toMatchObject({
      type: "report",
      id: "pbi-rel",
      embedUrl: CONFIG.embed_url,
      accessToken: "token-de-teste",
    });
  });

  it("mostra o erro, sem abrir nada, quando a configuracao falha", async () => {
    getEmbedConfig.mockRejectedValue(new Error("502"));
    render(<ReportEmbed reportId={34} />);

    expect(await screen.findByText("Nao foi possivel exibir o relatorio")).toBeTruthy();
    expect(mocks.service.embed).not.toHaveBeenCalled();
  });

  it("libera o container no servico compartilhado ao sair da tela", async () => {
    const { unmount } = render(<ReportEmbed reportId={34} />);
    await waitFor(() => expect(mocks.service.embed).toHaveBeenCalled());

    unmount();

    expect(mocks.service.reset).toHaveBeenCalledTimes(1);
  });

  it("nao libera nada se o relatorio nem chegou a ser aberto", async () => {
    let resolver!: (c: EmbedConfig) => void;
    getEmbedConfig.mockReturnValue(new Promise<EmbedConfig>((r) => (resolver = r)));
    const { unmount } = render(<ReportEmbed reportId={34} />);

    unmount();
    resolver(CONFIG);

    expect(mocks.service.embed).not.toHaveBeenCalled();
    expect(mocks.service.reset).not.toHaveBeenCalled();
  });

  it("com a medicao ligada registra os tempos quando os visuais terminam de desenhar", async () => {
    window.localStorage.setItem("bihoster_debug_embed", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    render(<ReportEmbed reportId={34} />);
    await waitFor(() => expect(mocks.service.embed).toHaveBeenCalled());

    act(() => {
      mocks.handlers.loaded();
      mocks.handlers.rendered();
    });

    expect(window.__bihosterEmbed).toHaveLength(1);
    expect(window.__bihosterEmbed?.[0]).toMatchObject({ relatorio: 34, erro: false, pre_carregado: true });
    expect(window.__bihosterEmbed?.[0].total_ms).not.toBeNull();
    info.mockRestore();
  });

  it("sem a medicao ligada nao escreve nada no console", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    render(<ReportEmbed reportId={34} />);
    await waitFor(() => expect(mocks.service.embed).toHaveBeenCalled());

    act(() => {
      mocks.handlers.rendered();
    });

    expect(info).not.toHaveBeenCalled();
    expect(window.__bihosterEmbed).toBeUndefined();
    info.mockRestore();
  });

  it("um erro do Power BI fecha a medicao marcada como erro", async () => {
    window.localStorage.setItem("bihoster_debug_embed", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    render(<ReportEmbed reportId={34} />);
    await waitFor(() => expect(mocks.service.embed).toHaveBeenCalled());

    act(() => {
      mocks.handlers.error();
    });

    expect(window.__bihosterEmbed?.[0]).toMatchObject({ erro: true });
    info.mockRestore();
  });
});

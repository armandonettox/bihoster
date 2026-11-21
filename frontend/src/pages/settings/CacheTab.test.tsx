import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as settingsApi from "../../api/settings";
import type { AppSettings, CacheStats } from "../../api/settings";
import CacheTab from "./CacheTab";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../api/settings", () => ({
  getSettings: vi.fn(),
  getCacheStats: vi.fn(),
  updateSettings: vi.fn(),
  resetCache: vi.fn(),
}));

const getSettings = vi.mocked(settingsApi.getSettings);
const getStats = vi.mocked(settingsApi.getCacheStats);
const updateSettings = vi.mocked(settingsApi.updateSettings);
const resetCache = vi.mocked(settingsApi.resetCache);

const SETTINGS = { cache_warmup_enabled: true, cache_warmup_interval_seconds: 240 } as unknown as AppSettings;
const STATS = {
  embed_tokens: 12,
  report_static: 5,
  refresh_info: 3,
  total_entries: 20,
  warmup_running: true,
  last_run_at: null,
  last_run_stats: { relatorios: 4, tokens_novos: 2, erros: 0 },
} as unknown as CacheStats;

const salvar = () => screen.getByRole("button", { name: /^Salvar/ }) as HTMLButtonElement;
const intervalo = () => screen.getByLabelText(/Intervalo de renovacao/) as HTMLInputElement;
const interruptor = () => screen.getByRole("switch") as HTMLInputElement;
const botao = (nome: string) => screen.getByRole("button", { name: nome });
const linha = (nome: string) => screen.getByText(nome).closest("li") as HTMLElement;

async function abrir(settings: Partial<AppSettings> = {}) {
  getSettings.mockResolvedValue({ ...SETTINGS, ...settings });
  render(<CacheTab />);
  await screen.findByText("Aquecimento automatico", { selector: ".email-template-name" });
}

beforeEach(() => {
  mocks.showToast.mockClear();
  getSettings.mockReset();
  getStats.mockReset();
  getStats.mockResolvedValue(STATS);
  updateSettings.mockReset();
  updateSettings.mockImplementation(async (data) => ({ ...SETTINGS, ...data }) as AppSettings);
  resetCache.mockReset();
  resetCache.mockResolvedValue({ ...STATS, total_entries: 0 });
});

describe("CacheTab - a lista", () => {
  it("tem as três partes e nada aberto", async () => {
    await abrir();

    expect(within(linha("Aquecimento automatico")).getByRole("button", { name: "Editar Aquecimento automatico" })).toBeTruthy();
    expect(within(linha("Status do cache")).getByRole("button", { name: "Abrir Status do cache" })).toBeTruthy();
    expect(within(linha("Resetar cache")).getByRole("button", { name: "Resetar o cache agora" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("mostra o estado do aquecimento e o resumo do status", async () => {
    await abrir();

    expect(within(linha("Aquecimento automatico")).getByText("Ligado")).toBeTruthy();
    expect(within(linha("Aquecimento automatico")).getByText("Renova a cada 240 segundos")).toBeTruthy();
    expect(within(linha("Status do cache")).getByText("20 em cache · tarefa rodando")).toBeTruthy();
  });

  it("com o aquecimento desligado mostra Desligado e sem o intervalo", async () => {
    await abrir({ cache_warmup_enabled: false } as Partial<AppSettings>);

    expect(within(linha("Aquecimento automatico")).getByText("Desligado")).toBeTruthy();
    expect(screen.queryByText(/Renova a cada/)).toBeNull();
  });

  it("o botão de resetar é vermelho", async () => {
    await abrir();

    expect(botao("Resetar o cache agora").className).toContain("btn-danger");
  });
});

describe("CacheTab - aquecimento automático", () => {
  it("abre com o que está salvo e o Salvar desligado", async () => {
    await abrir();
    fireEvent.click(botao("Editar Aquecimento automatico"));

    expect(interruptor().checked).toBe(true);
    expect(intervalo().value).toBe("240");
    expect(salvar().disabled).toBe(true);
  });

  it("Salvar manda o aquecimento e o intervalo, avisa, atualiza a lista e fecha", async () => {
    await abrir();
    fireEvent.click(botao("Editar Aquecimento automatico"));

    fireEvent.change(intervalo(), { target: { value: "600" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ cache_warmup_enabled: true, cache_warmup_interval_seconds: 600 }));
    expect(mocks.showToast).toHaveBeenCalledWith("Configuracoes de cache salvas.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(linha("Aquecimento automatico")).getByText("Renova a cada 600 segundos")).toBeTruthy();
  });

  it("intervalo fora de 30 a 3600 mostra o erro e não deixa salvar", async () => {
    await abrir();
    fireEvent.click(botao("Editar Aquecimento automatico"));

    fireEvent.change(intervalo(), { target: { value: "10" } });

    expect(screen.getByRole("alert").textContent).toBe("Intervalo deve ser entre 30 e 3600 segundos.");
    expect(salvar().disabled).toBe(true);
    fireEvent.change(intervalo(), { target: { value: "4000" } });
    expect(salvar().disabled).toBe(true);
    fireEvent.change(intervalo(), { target: { value: "30" } });
    expect(salvar().disabled).toBe(false);
  });

  it("desligar trava o campo do intervalo e salva mesmo com o intervalo antigo", async () => {
    await abrir();
    fireEvent.click(botao("Editar Aquecimento automatico"));

    fireEvent.click(interruptor());

    expect(intervalo().disabled).toBe(true);
    fireEvent.click(salvar());
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ cache_warmup_enabled: false, cache_warmup_interval_seconds: 240 }));
  });

  it("falha ao salvar mostra o erro na janela e mantém o que foi digitado", async () => {
    await abrir();
    fireEvent.click(botao("Editar Aquecimento automatico"));
    updateSettings.mockRejectedValueOnce(new Error("500"));

    fireEvent.change(intervalo(), { target: { value: "600" } });
    fireEvent.click(salvar());

    expect((await screen.findByRole("alert")).textContent).toBe("Nao foi possivel salvar.");
    expect(intervalo().value).toBe("600");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Cancelar fecha sem gravar", async () => {
    await abrir();
    fireEvent.click(botao("Editar Aquecimento automatico"));

    fireEvent.change(intervalo(), { target: { value: "600" } });
    fireEvent.click(botao("Cancelar"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateSettings).not.toHaveBeenCalled();
  });
});

describe("CacheTab - status", () => {
  it("abre com os números do cache e o estado da tarefa", async () => {
    await abrir();
    fireEvent.click(botao("Abrir Status do cache"));

    const janela = screen.getByRole("dialog");
    expect(within(janela).getByText("Tokens de embed")).toBeTruthy();
    expect(within(janela).getByText("12")).toBeTruthy();
    expect(within(janela).getByText("Total em cache")).toBeTruthy();
    expect(within(janela).getByText("rodando")).toBeTruthy();
    expect(within(janela).getByText(/4 relatorios, 2 tokens novos, 0 erros/)).toBeTruthy();
  });

  it("sem conseguir carregar o status, a janela avisa", async () => {
    getStats.mockRejectedValue(new Error("403"));
    await abrir();
    fireEvent.click(botao("Abrir Status do cache"));

    expect(within(screen.getByRole("dialog")).getByText("Nao foi possivel carregar o status.")).toBeTruthy();
  });
});

describe("CacheTab - resetar", () => {
  it("pede confirmação antes de limpar", async () => {
    await abrir();

    fireEvent.click(botao("Resetar o cache agora"));

    expect(screen.getByText(/vai limpar todos os tokens de embed/)).toBeTruthy();
    expect(resetCache).not.toHaveBeenCalled();
  });

  it("confirmar limpa, avisa e atualiza o resumo do status", async () => {
    await abrir();

    fireEvent.click(botao("Resetar o cache agora"));
    fireEvent.click(screen.getByRole("button", { name: "Resetar cache" }));

    await waitFor(() => expect(resetCache).toHaveBeenCalledTimes(1));
    expect(mocks.showToast).toHaveBeenCalledWith("Cache limpo. Os tokens serao gerados novamente ao proximo acesso.");
    await waitFor(() => expect(within(linha("Status do cache")).getByText("0 em cache · tarefa rodando")).toBeTruthy());
  });

  it("cancelar não limpa nada", async () => {
    await abrir();

    fireEvent.click(botao("Resetar o cache agora"));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(resetCache).not.toHaveBeenCalled();
    expect(screen.queryByText(/vai limpar todos os tokens de embed/)).toBeNull();
  });

  it("falha ao limpar avisa o erro", async () => {
    await abrir();
    resetCache.mockRejectedValueOnce(new Error("500"));

    fireEvent.click(botao("Resetar o cache agora"));
    fireEvent.click(screen.getByRole("button", { name: "Resetar cache" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Nao foi possivel limpar o cache.", "error"));
  });
});

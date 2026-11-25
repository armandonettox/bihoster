import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as settingsApi from "../../api/settings";
import type { AppSettings, CacheStats } from "../../api/settings";
import * as capacityApi from "../../api/cacheCapacity";
import CacheTab from "./CacheTab";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../api/settings", () => ({
  getSettings: vi.fn(),
  getCacheStats: vi.fn(),
  updateSettings: vi.fn(),
  resetCache: vi.fn(),
}));

vi.mock("../../api/cacheCapacity", () => ({
  getOpenings: vi.fn(),
  getCapacity: vi.fn(),
  saveCapacity: vi.fn(),
  capacityAction: vi.fn(),
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

describe("CacheTab - cache e capacidade (v1.54.0)", () => {
  it("tem o novo titulo e as partes novas", async () => {
    await abrir();

    expect(screen.getByRole("heading", { name: "Cache e capacidade" })).toBeTruthy();
    expect(within(linha("Pre-carga e aquecimento recente")).getByText(/Pre-carga ligada · aquecimento de todos os relatorios/)).toBeTruthy();
    expect(within(linha("Capacidade do Power BI")).getByText("Desligado")).toBeTruthy();
    expect(screen.getByText("Aberturas por hora", { selector: ".email-template-name" })).toBeTruthy();
    expect(screen.getByText("Cache de consultas do modelo", { selector: ".email-template-name" })).toBeTruthy();
  });

  it("a pre-carga vem ligada e o aquecimento recente vem desligado; salvar manda os tres campos", async () => {
    await abrir({ embed_preload_enabled: true, cache_warmup_only_recent: false, cache_warmup_recent_hours: 72 });

    fireEvent.click(botao("Editar Pre-carga e aquecimento recente"));
    const dialogo = await screen.findByRole("dialog");
    const [preload, recente] = within(dialogo).getAllByRole("switch") as HTMLInputElement[];
    expect(preload.checked).toBe(true);
    expect(recente.checked).toBe(false);

    fireEvent.click(recente);
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Salvar/ }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ embed_preload_enabled: true, cache_warmup_only_recent: true, cache_warmup_recent_hours: 72 }));
  });

  it("as aberturas por hora aparecem numa tabela de contagem", async () => {
    vi.mocked(capacityApi.getOpenings).mockResolvedValue({
      hours: 24,
      reports: [{ report_id: 1, report_name: "Resultado", total: 4, by_hour: { "2026-11-25T14": 1, "2026-11-25T15": 3 } }],
    });
    await abrir();

    fireEvent.click(botao("Abrir Aberturas por hora"));

    const tabela = await screen.findByRole("table", { name: "Aberturas por relatorio e por hora" });
    expect(within(tabela).getByText("Resultado")).toBeTruthy();
    expect(within(tabela).getByText("15h")).toBeTruthy();
    expect(screen.getByText(/nao guarda quem abriu/)).toBeTruthy();
  });

  it("a orientacao do cache de consultas cita a fonte e diz que o sistema nao liga isso", async () => {
    await abrir();

    fireEvent.click(botao("Ler Cache de consultas do modelo"));

    expect(await screen.findByText(/nao liga isso por voce/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Query caching in Power BI Premium/ }).getAttribute("href")).toContain("learn.microsoft.com");
  });

  it("a capacidade vem desligada: botoes travados e a chave geral grava na hora", async () => {
    vi.mocked(capacityApi.getCapacity).mockResolvedValue({
      master_switch: false,
      connections: [
        { connection_id: 4, name: "Conta A", azure_subscription_id: null, azure_resource_group: null, azure_capacity_name: null, configured: false, simulated: true, capacity_schedule_enabled: false, schedule: [], state: null, state_at: null },
      ],
    });
    await abrir({ capacity_control_enabled: false });

    fireEvent.click(botao("Editar Capacidade do Power BI"));
    await screen.findByLabelText("Capacidade da conta Conta A");
    expect((screen.getByRole("button", { name: "Pausar agora" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Retomar agora" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Ligue a chave geral/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Permitir controle da capacidade"));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ capacity_control_enabled: true }));
  });

  it("com tudo preenchido, pausar manda a acao e avisa que foi simulado", async () => {
    vi.mocked(capacityApi.getCapacity).mockResolvedValue({
      master_switch: true,
      connections: [
        { connection_id: 4, name: "Conta A", azure_subscription_id: "s", azure_resource_group: "g", azure_capacity_name: "c", configured: true, simulated: true, capacity_schedule_enabled: false, schedule: [], state: null, state_at: null },
      ],
    });
    vi.mocked(capacityApi.capacityAction).mockResolvedValue({
      connection_id: 4, name: "Conta A", azure_subscription_id: "s", azure_resource_group: "g", azure_capacity_name: "c", configured: true, simulated: true, capacity_schedule_enabled: false, schedule: [], state: "paused", state_at: null, mode: "simulated",
    });
    await abrir({ capacity_control_enabled: true });

    fireEvent.click(botao("Editar Capacidade do Power BI"));
    await screen.findByLabelText("Capacidade da conta Conta A");
    fireEvent.click(screen.getByRole("button", { name: "Pausar agora" }));

    await waitFor(() => expect(capacityApi.capacityAction).toHaveBeenCalledWith(4, "suspend"));
    expect(mocks.showToast).toHaveBeenCalledWith("Pausa simulada (nada foi enviado ao Azure).");
  });

  it("o modo real pede confirmacao antes de valer", async () => {
    vi.mocked(capacityApi.getCapacity).mockResolvedValue({
      master_switch: true,
      connections: [
        { connection_id: 4, name: "Conta A", azure_subscription_id: "s", azure_resource_group: "g", azure_capacity_name: "c", configured: true, simulated: true, capacity_schedule_enabled: false, schedule: [], state: null, state_at: null },
      ],
    });
    vi.mocked(capacityApi.saveCapacity).mockResolvedValue({
      connection_id: 4, name: "Conta A", azure_subscription_id: "s", azure_resource_group: "g", azure_capacity_name: "c", configured: true, simulated: false, capacity_schedule_enabled: false, schedule: [], state: null, state_at: null,
    });
    await abrir({ capacity_control_enabled: true });
    fireEvent.click(botao("Editar Capacidade do Power BI"));
    await screen.findByLabelText("Capacidade da conta Conta A");

    fireEvent.click(screen.getByLabelText(/Chamar o Azure de verdade/));
    expect(screen.getByText(/derruba a capacidade/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sim, usar o Azure" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(capacityApi.saveCapacity).toHaveBeenCalledWith(4, expect.objectContaining({ capacity_real_calls: true, capacity_schedule_enabled: false })));
  });
});

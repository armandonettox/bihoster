import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as settingsApi from "../../api/settings";
import type { AppSettings } from "../../api/settings";
import * as workspacesApi from "../../api/workspaces";
import GeneralTab from "./GeneralTab";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  settings: null as unknown,
  reload: vi.fn(),
}));

vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../context/BrandingContext", () => ({
  useBranding: () => ({ settings: mocks.settings, reload: mocks.reload }),
}));
vi.mock("../../components/PowerBiConnectionsSection", () => ({ default: () => null }));
vi.mock("../../api/settings", () => ({ updateSettings: vi.fn() }));
vi.mock("../../api/workspaces", () => ({ listAllWorkspaces: vi.fn() }));

const updateSettings = vi.mocked(settingsApi.updateSettings);
const listWorkspaces = vi.mocked(workspacesApi.listAllWorkspaces);

const BASE = {
  company_name: "BIHoster",
  site_url: "https://bi.exemplo.com",
  support_email: "suporte@exemplo.com",
  force_https: false,
  timezone: "America/Sao_Paulo",
  default_workspace_id: 2,
  single_collection_redirect: false,
} as unknown as AppSettings;

const nome = () => screen.getByLabelText(/Nome do site/) as HTMLInputElement;
const url = () => screen.getByLabelText(/URL do site/) as HTMLInputElement;
const email = () => screen.getByLabelText(/E-mail de suporte/) as HTMLInputElement;
const fuso = () => screen.getByLabelText(/Fuso horário/) as HTMLSelectElement;
const https = () => screen.getByLabelText(/Redirecionar para HTTPS/) as HTMLInputElement;
const colecao = () => screen.getByLabelText(/^Coleção/) as HTMLSelectElement;
const unica = () => screen.getByLabelText(/Abrir direto na coleção única/) as HTMLInputElement;
const salvar = () => screen.getByRole("button", { name: /^Salvar/ }) as HTMLButtonElement;
const editar = (nomeDaLinha: string) => fireEvent.click(screen.getByRole("button", { name: `Editar ${nomeDaLinha}` }));
const linha = (nomeDaLinha: string) => screen.getByText(nomeDaLinha).closest("li") as HTMLElement;

async function abrir(settings: Partial<AppSettings> = {}) {
  mocks.settings = { ...BASE, ...settings };
  render(<GeneralTab />);
  await waitFor(() => expect(listWorkspaces).toHaveBeenCalled());
}

beforeEach(() => {
  mocks.showToast.mockClear();
  mocks.settings = { ...BASE };
  mocks.reload.mockReset();
  mocks.reload.mockResolvedValue(undefined);
  // Recarregar a marca devolve o que acabou de ser salvo, como o servidor faz
  updateSettings.mockReset();
  updateSettings.mockImplementation(async (data) => {
    mocks.settings = { ...(mocks.settings as object), ...data };
    return mocks.settings as AppSettings;
  });
  listWorkspaces.mockReset();
  listWorkspaces.mockResolvedValue([
    { id: 1, name: "Financeiro" },
    { id: 2, name: "Comercial" },
  ] as never);
});

describe("GeneralTab - a lista", () => {
  it("tem uma linha para cada parte, com o botão de editar, e nada aberto", async () => {
    await abrir();

    for (const nomeDaLinha of ["Dados do aplicativo", "Acesso seguro (HTTPS)", "Homepage"]) {
      expect(within(linha(nomeDaLinha)).getByRole("button", { name: `Editar ${nomeDaLinha}` })).toBeTruthy();
    }
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cada linha mostra o estado atual", async () => {
    await abrir();

    expect(within(linha("Dados do aplicativo")).getByText(/BIHoster · UTC−03:00|BIHoster · UTC-03:00/)).toBeTruthy();
    expect(within(linha("Acesso seguro (HTTPS)")).getByText("Desligado")).toBeTruthy();
    await waitFor(() => expect(within(linha("Homepage")).getByText("Coleção: Comercial")).toBeTruthy());
    expect(within(linha("Homepage")).getByText("Definida")).toBeTruthy();
  });

  it("com HTTPS ligado e sem homepage a linha mostra Ligado e tela padrão", async () => {
    await abrir({ force_https: true, default_workspace_id: null } as Partial<AppSettings>);

    expect(within(linha("Acesso seguro (HTTPS)")).getByText("Ligado")).toBeTruthy();
    expect(within(linha("Homepage")).getByText("Tela padrão")).toBeTruthy();
    expect(within(linha("Homepage")).getByText("Padrão")).toBeTruthy();
  });

  it("sem a marca carregada os botões de editar ficam desligados", async () => {
    mocks.settings = null;
    render(<GeneralTab />);

    expect((screen.getByRole("button", { name: "Editar Homepage" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("os textos da aba têm acento", async () => {
    await abrir();

    expect(screen.getByText("Configuração do aplicativo")).toBeTruthy();
    expect(screen.getByText("Dados do aplicativo")).toBeTruthy();
  });
});

describe("GeneralTab - dados do aplicativo", () => {
  it("abre com o que está salvo e o Salvar desligado", async () => {
    await abrir();
    editar("Dados do aplicativo");

    expect(nome().value).toBe("BIHoster");
    expect(url().value).toBe("https://bi.exemplo.com");
    expect(email().value).toBe("suporte@exemplo.com");
    expect(fuso().value).toBe("America/Sao_Paulo");
    expect(salvar().disabled).toBe(true);
  });

  it("mudar um campo liga o Salvar e voltar ao valor salvo desliga de novo", async () => {
    await abrir();
    editar("Dados do aplicativo");

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    expect(salvar().disabled).toBe(false);
    fireEvent.change(nome(), { target: { value: "BIHoster" } });
    expect(salvar().disabled).toBe(true);
  });

  it("Salvar manda os quatro campos, recarrega, avisa e fecha a janela", async () => {
    await abrir();
    editar("Dados do aplicativo");

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.change(fuso(), { target: { value: "UTC" } });
    fireEvent.click(salvar());

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        company_name: "Portal Best",
        site_url: "https://bi.exemplo.com",
        support_email: "suporte@exemplo.com",
        timezone: "UTC",
      }),
    );
    expect(mocks.reload).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("Configurações salvas.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("campos opcionais vazios vão como nulo", async () => {
    await abrir();
    editar("Dados do aplicativo");

    fireEvent.change(url(), { target: { value: "" } });
    fireEvent.change(email(), { target: { value: "" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ site_url: null, support_email: null })));
  });

  it("falha ao salvar mostra o erro na janela, mantém o que foi digitado e deixa o Salvar ligado", async () => {
    await abrir();
    editar("Dados do aplicativo");
    updateSettings.mockRejectedValueOnce({ response: { data: { detail: "Fuso inválido" } } });

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.click(salvar());

    expect((await screen.findByRole("alert")).textContent).toBe("Fuso inválido");
    expect(nome().value).toBe("Portal Best");
    expect(salvar().disabled).toBe(false);
  });

  it("falha sem mensagem do servidor mostra um aviso padrão", async () => {
    await abrir();
    editar("Dados do aplicativo");
    updateSettings.mockRejectedValueOnce(new Error("rede"));

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.click(salvar());

    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível salvar as configurações.");
  });

  it("Cancelar fecha sem gravar", async () => {
    await abrir();
    editar("Dados do aplicativo");

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("a dica do fuso mostra o deslocamento do fuso escolhido e os fusos têm o nome correto", async () => {
    await abrir();
    editar("Dados do aplicativo");

    expect(within(fuso()).getByText(/Brasília, São Paulo/)).toBeTruthy();
    fireEvent.change(fuso(), { target: { value: "UTC" } });

    expect(screen.getByText(/Atual: UTC\+00:00\./)).toBeTruthy();
  });

  it("todo campo tem rótulo e dica ligados, e nenhum rótulo fica dentro de outro", async () => {
    await abrir();
    editar("Dados do aplicativo");

    for (const campo of [nome(), url(), email(), fuso()]) {
      expect(document.querySelector(`label[for="${campo.id}"]`)).not.toBeNull();
      expect(document.getElementById(campo.getAttribute("aria-describedby") ?? "")).not.toBeNull();
    }
    expect(document.querySelectorAll("label label")).toHaveLength(0);
  });
});

describe("GeneralTab - ligar o HTTPS", () => {
  it("o interruptor é do tipo switch, com nome e dica ligados por aria", async () => {
    await abrir();
    editar("Acesso seguro (HTTPS)");

    expect(https().getAttribute("role")).toBe("switch");
    expect(https().getAttribute("aria-labelledby")).toContain("general-force-https-label");
    expect(document.getElementById(https().getAttribute("aria-describedby") ?? "")?.textContent?.length).toBeGreaterThan(20);
  });

  it("ligar o HTTPS e salvar pede confirmação antes de gravar", async () => {
    await abrir();
    editar("Acesso seguro (HTTPS)");

    fireEvent.click(https());
    fireEvent.click(salvar());

    expect(screen.getByText("Ligar o redirecionamento para HTTPS?")).toBeTruthy();
    expect(screen.getByText(/pode ficar fora do ar/)).toBeTruthy();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("cancelar a confirmação não grava e mantém o que estava marcado", async () => {
    await abrir();
    editar("Acesso seguro (HTTPS)");

    fireEvent.click(https());
    fireEvent.click(salvar());
    const cancelar = screen.getAllByText("Cancelar");
    fireEvent.click(cancelar[cancelar.length - 1]);

    expect(screen.queryByText("Ligar o redirecionamento para HTTPS?")).toBeNull();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(https().checked).toBe(true);
    expect(salvar().disabled).toBe(false);
  });

  it("confirmar grava só o HTTPS ligado e fecha a janela", async () => {
    await abrir();
    editar("Acesso seguro (HTTPS)");

    fireEvent.click(https());
    fireEvent.click(salvar());
    fireEvent.click(screen.getByText("Ligar e salvar"));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ force_https: true }));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Configurações salvas."));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("desligar o HTTPS salva sem pedir confirmação", async () => {
    await abrir({ force_https: true });
    editar("Acesso seguro (HTTPS)");

    fireEvent.click(https());
    fireEvent.click(salvar());

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ force_https: false }));
    expect(screen.queryByText("Ligar o redirecionamento para HTTPS?")).toBeNull();
  });
});

describe("GeneralTab - homepage", () => {
  it("abre com a coleção salva e o atalho da coleção única", async () => {
    await abrir({ single_collection_redirect: true } as Partial<AppSettings>);
    editar("Homepage");

    await waitFor(() => expect(colecao().options.length).toBeGreaterThan(1));
    expect(colecao().value).toBe("2");
    expect(unica().checked).toBe(true);
    expect(within(colecao()).getByText("Nenhuma (tela padrão)")).toBeTruthy();
    expect(salvar().disabled).toBe(true);
  });

  it("Salvar manda a coleção e o atalho", async () => {
    await abrir();
    editar("Homepage");
    await waitFor(() => expect(colecao().options.length).toBeGreaterThan(1));

    fireEvent.change(colecao(), { target: { value: "1" } });
    fireEvent.click(unica());
    fireEvent.click(salvar());

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ default_workspace_id: 1, single_collection_redirect: true }));
  });

  it("Nenhuma coleção vai como nulo", async () => {
    await abrir();
    editar("Homepage");
    await waitFor(() => expect(colecao().options.length).toBeGreaterThan(1));

    fireEvent.change(colecao(), { target: { value: "" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ default_workspace_id: null, single_collection_redirect: false }));
  });

  it("se a lista de coleções falhar a tela continua e o seletor fica só com Nenhuma", async () => {
    listWorkspaces.mockRejectedValue(new Error("403"));
    await abrir({ default_workspace_id: null } as Partial<AppSettings>);
    editar("Homepage");

    expect(colecao().options).toHaveLength(1);
    expect(screen.getByText("Nenhuma (tela padrão)")).toBeTruthy();
  });

  it("o estado do interruptor faz parte do nome e muda ao ligar", async () => {
    await abrir();
    editar("Homepage");

    expect(screen.getByText("Desabilitado")).toBeTruthy();
    fireEvent.click(unica());
    expect(screen.getByText("Habilitado")).toBeTruthy();
  });
});

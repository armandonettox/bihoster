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
// A barra de salvar só existe quando há mudança (ou enquanto salva)
const salvar = () => screen.getByText("Salvar") as HTMLButtonElement;
const semBarra = () => expect(screen.queryByText("Salvar")).toBeNull();

async function abrir(settings: Partial<AppSettings> = {}) {
  mocks.settings = { ...BASE, ...settings };
  render(<GeneralTab />);
  await waitFor(() => expect(colecao().options.length).toBeGreaterThan(1));
}

beforeEach(() => {
  mocks.showToast.mockClear();
  mocks.settings = { ...BASE };
  // Recarregar a marca devolve o que acabou de ser salvo, como o servidor faz
  updateSettings.mockReset();
  updateSettings.mockImplementation(async (data) => {
    mocks.settings = { ...(mocks.settings as object), ...data };
    return mocks.settings as AppSettings;
  });
  mocks.reload.mockReset();
  mocks.reload.mockResolvedValue(undefined);
  listWorkspaces.mockReset();
  listWorkspaces.mockResolvedValue([
    { id: 1, name: "Comercial" },
    { id: 2, name: "Saude" },
  ] as never);
});

describe("GeneralTab - salvar tudo junto", () => {
  it("sem mudança não mostra a barra de salvar nem o aviso", async () => {
    await abrir();

    semBarra();
    expect(screen.queryByText("Descartar")).toBeNull();
    expect(screen.queryByText(/alterações não salvas/)).toBeNull();
  });

  it("mudar qualquer campo mostra a barra com o Salvar ligado, o aviso e o Descartar", async () => {
    await abrir();

    fireEvent.change(nome(), { target: { value: "Portal Best" } });

    expect(salvar().disabled).toBe(false);
    expect(screen.getByText("Você tem alterações não salvas.")).toBeTruthy();
    expect(screen.getByText("Descartar")).toBeTruthy();
  });

  it("voltar ao valor salvo esconde a barra de novo", async () => {
    await abrir();

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.change(nome(), { target: { value: "BIHoster" } });

    semBarra();
  });

  it("Descartar volta todos os campos ao que está salvo e some com a barra", async () => {
    await abrir();

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.change(colecao(), { target: { value: "1" } });
    fireEvent.click(unica());
    fireEvent.click(screen.getByText("Descartar"));

    expect(nome().value).toBe("BIHoster");
    expect(colecao().value).toBe("2");
    expect(unica().checked).toBe(false);
    semBarra();
  });

  it("a Homepage e o redirecionamento da coleção única não gravam na hora", async () => {
    await abrir();

    fireEvent.change(colecao(), { target: { value: "1" } });
    fireEvent.click(unica());

    expect(updateSettings).not.toHaveBeenCalled();
    expect(salvar().disabled).toBe(false);
  });

  it("Salvar manda todos os campos numa chamada só, recarrega, avisa e esconde a barra", async () => {
    await abrir();

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.change(colecao(), { target: { value: "1" } });
    fireEvent.click(unica());
    fireEvent.click(salvar());

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        company_name: "Portal Best",
        site_url: "https://bi.exemplo.com",
        support_email: "suporte@exemplo.com",
        force_https: false,
        timezone: "America/Sao_Paulo",
        default_workspace_id: 1,
        single_collection_redirect: true,
      }),
    );
    expect(updateSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Configurações salvas."));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    await waitFor(() => semBarra());
    expect(screen.queryByText(/alterações não salvas/)).toBeNull();
  });

  it("enquanto grava, a barra mostra Salvando e o botão fica desligado", async () => {
    await abrir();
    let terminar: () => void = () => undefined;
    updateSettings.mockImplementation(() => new Promise<AppSettings>((resolve) => (terminar = () => resolve(BASE))));

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.click(salvar());

    const botao = await screen.findByText("Salvando...");
    expect((botao as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Descartar")).toBeNull();
    terminar();
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Configurações salvas."));
  });

  it("campos opcionais vazios e Nenhuma coleção vão como nulo", async () => {
    await abrir();

    fireEvent.change(url(), { target: { value: "" } });
    fireEvent.change(email(), { target: { value: "" } });
    fireEvent.change(colecao(), { target: { value: "" } });
    fireEvent.click(salvar());

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ site_url: null, support_email: null, default_workspace_id: null }),
      ),
    );
  });

  it("falha ao salvar avisa o erro, mantém o que foi digitado e deixa o Salvar ligado", async () => {
    await abrir();
    updateSettings.mockRejectedValue({ response: { data: { detail: "Sem permissao" } } });

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Sem permissao", "error"));
    expect(mocks.showToast).not.toHaveBeenCalledWith("Configurações salvas.");
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(nome().value).toBe("Portal Best");
    await waitFor(() => expect(salvar().disabled).toBe(false));
  });

  it("falha sem mensagem do servidor mostra um aviso padrão", async () => {
    await abrir();
    updateSettings.mockRejectedValue(new Error("rede"));

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.click(salvar());

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining("Não foi possível salvar"), "error"),
    );
  });

  it("se a lista de coleções falhar a tela continua e o seletor fica só com Nenhuma", async () => {
    listWorkspaces.mockRejectedValue(new Error("falhou"));
    mocks.settings = { ...BASE, default_workspace_id: null };
    render(<GeneralTab />);

    await waitFor(() => expect(listWorkspaces).toHaveBeenCalled());
    expect(nome().value).toBe("BIHoster");
    expect(colecao().options).toHaveLength(1);
  });
});

describe("GeneralTab - ligar o HTTPS", () => {
  it("ligar o HTTPS e salvar pede confirmação antes de gravar", async () => {
    await abrir();

    fireEvent.click(https());
    fireEvent.click(salvar());

    expect(screen.getByText("Ligar o redirecionamento para HTTPS?")).toBeTruthy();
    expect(screen.getByText(/pode ficar fora do ar/)).toBeTruthy();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("cancelar a confirmação não grava e mantém o que estava marcado", async () => {
    await abrir();

    fireEvent.click(https());
    fireEvent.click(salvar());
    fireEvent.click(screen.getByText("Cancelar"));

    expect(screen.queryByText("Ligar o redirecionamento para HTTPS?")).toBeNull();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(https().checked).toBe(true);
    expect(salvar().disabled).toBe(false);
  });

  it("confirmar grava com o HTTPS ligado", async () => {
    await abrir();

    fireEvent.click(https());
    fireEvent.click(salvar());
    fireEvent.click(screen.getByText("Ligar e salvar"));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ force_https: true })));
    expect(screen.queryByText("Ligar o redirecionamento para HTTPS?")).toBeNull();
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Configurações salvas."));
  });

  it("com o HTTPS já ligado, salvar outra coisa não pede confirmação", async () => {
    await abrir({ force_https: true });

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(screen.queryByText("Ligar o redirecionamento para HTTPS?")).toBeNull();
  });

  it("desligar o HTTPS salva sem pedir confirmação", async () => {
    await abrir({ force_https: true });

    fireEvent.click(https());
    fireEvent.click(salvar());

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ force_https: false })));
    expect(screen.queryByText("Ligar o redirecionamento para HTTPS?")).toBeNull();
  });

  it("mudar só outra coisa com o HTTPS desligado também não pede confirmação", async () => {
    await abrir();

    fireEvent.change(email(), { target: { value: "novo@exemplo.com" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(screen.queryByText("Ligar o redirecionamento para HTTPS?")).toBeNull();
  });
});

describe("GeneralTab - acessibilidade e textos", () => {
  it("os interruptores são do tipo switch, com nome e dica ligados por aria", async () => {
    await abrir();

    for (const interruptor of [https(), unica()]) {
      expect(interruptor.getAttribute("role")).toBe("switch");
      const hint = document.getElementById(interruptor.getAttribute("aria-describedby") ?? "");
      expect(hint?.textContent?.length).toBeGreaterThan(20);
    }
    expect(https().getAttribute("aria-labelledby")).toContain("general-force-https-label");
  });

  it("o estado do interruptor faz parte do nome e muda ao ligar", async () => {
    await abrir();

    expect(screen.getAllByText("Desabilitado")).toHaveLength(2);
    fireEvent.click(https());

    expect(screen.getAllByText("Desabilitado")).toHaveLength(1);
    expect(screen.getByText("Habilitado")).toBeTruthy();
  });

  it("nenhum rótulo fica dentro de outro rótulo", async () => {
    await abrir();

    expect(document.querySelectorAll("label label")).toHaveLength(0);
  });

  it("a dica fica fora do rótulo e é ligada ao campo, então o nome do campo é só o rótulo", async () => {
    await abrir();

    const campo = nome();
    const rotulo = document.querySelector(`label[for="${campo.id}"]`);
    expect(rotulo?.textContent).toBe("Nome do site");
    const hint = document.getElementById(campo.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toContain("barra lateral");
  });

  it("todo campo de texto e seletor tem rótulo e dica ligados", async () => {
    await abrir();

    for (const campo of [nome(), url(), email(), fuso(), colecao()]) {
      expect(document.querySelector(`label[for="${campo.id}"]`)).not.toBeNull();
      expect(document.getElementById(campo.getAttribute("aria-describedby") ?? "")).not.toBeNull();
    }
  });

  it("os textos da aba têm acento e os fusos aparecem com o nome correto", async () => {
    await abrir();

    expect(screen.getByText("Configuração do aplicativo")).toBeTruthy();
    expect(screen.getByText("Informações gerais desta instância do sistema.")).toBeTruthy();
    expect(within(fuso()).getByText(/Brasília, São Paulo/)).toBeTruthy();
    expect(within(colecao()).getByText("Nenhuma (tela padrão)")).toBeTruthy();
  });

  it("a dica do fuso mostra o deslocamento do fuso escolhido", async () => {
    await abrir();

    fireEvent.change(fuso(), { target: { value: "UTC" } });

    expect(screen.getByText(/Atual: UTC\+00:00\./)).toBeTruthy();
  });
});

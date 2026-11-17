import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const https = () => screen.getByLabelText(/Redirecionar para HTTPS/) as HTMLInputElement;
const colecao = () => screen.getByLabelText(/^Colecao/) as HTMLSelectElement;
const unica = () => screen.getByLabelText(/Abrir direto a colecao unica/) as HTMLInputElement;
const salvar = () => screen.getByText("Salvar") as HTMLButtonElement;

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
  it("comeca com o Salvar desligado e sem aviso de mudanca", async () => {
    await abrir();

    expect(salvar().disabled).toBe(true);
    expect(screen.queryByText("Descartar")).toBeNull();
    expect(screen.queryByText(/alteracoes nao salvas/)).toBeNull();
  });

  it("mudar qualquer campo liga o Salvar e mostra o aviso e o Descartar", async () => {
    await abrir();

    fireEvent.change(nome(), { target: { value: "Portal Best" } });

    expect(salvar().disabled).toBe(false);
    expect(screen.getByText("Voce tem alteracoes nao salvas.")).toBeTruthy();
    expect(screen.getByText("Descartar")).toBeTruthy();
  });

  it("voltar ao valor salvo desliga o Salvar de novo", async () => {
    await abrir();

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.change(nome(), { target: { value: "BIHoster" } });

    expect(salvar().disabled).toBe(true);
  });

  it("Descartar volta todos os campos ao que esta salvo", async () => {
    await abrir();

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.change(colecao(), { target: { value: "1" } });
    fireEvent.click(unica());
    fireEvent.click(screen.getByText("Descartar"));

    expect(nome().value).toBe("BIHoster");
    expect(colecao().value).toBe("2");
    expect(unica().checked).toBe(false);
    expect(salvar().disabled).toBe(true);
  });

  it("a Homepage e o redirecionamento da colecao unica nao gravam na hora", async () => {
    await abrir();

    fireEvent.change(colecao(), { target: { value: "1" } });
    fireEvent.click(unica());

    expect(updateSettings).not.toHaveBeenCalled();
    expect(salvar().disabled).toBe(false);
  });

  it("Salvar manda todos os campos numa chamada so, recarrega, avisa e desliga o botao", async () => {
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
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Configuracoes salvas."));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(salvar().disabled).toBe(true));
    expect(screen.queryByText(/alteracoes nao salvas/)).toBeNull();
  });

  it("campos opcionais vazios e Nenhuma colecao vao como nulo", async () => {
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

  it("falha ao salvar avisa o erro, mantem o que foi digitado e deixa o Salvar ligado", async () => {
    await abrir();
    updateSettings.mockRejectedValue({ response: { data: { detail: "Sem permissao" } } });

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Sem permissao", "error"));
    expect(mocks.showToast).not.toHaveBeenCalledWith("Configuracoes salvas.");
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(nome().value).toBe("Portal Best");
    await waitFor(() => expect(salvar().disabled).toBe(false));
  });

  it("falha sem mensagem do servidor mostra um aviso padrao", async () => {
    await abrir();
    updateSettings.mockRejectedValue(new Error("rede"));

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.click(salvar());

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining("Nao foi possivel salvar"), "error"),
    );
  });

  it("se a lista de colecoes falhar a tela continua e o seletor fica so com Nenhuma", async () => {
    listWorkspaces.mockRejectedValue(new Error("falhou"));
    mocks.settings = { ...BASE, default_workspace_id: null };
    render(<GeneralTab />);

    await waitFor(() => expect(listWorkspaces).toHaveBeenCalled());
    expect(nome().value).toBe("BIHoster");
    expect(colecao().options).toHaveLength(1);
  });
});

describe("GeneralTab - ligar o HTTPS", () => {
  it("ligar o HTTPS e salvar pede confirmacao antes de gravar", async () => {
    await abrir();

    fireEvent.click(https());
    fireEvent.click(salvar());

    expect(screen.getByText("Ligar o redirecionamento para HTTPS?")).toBeTruthy();
    expect(screen.getByText(/pode ficar fora do ar/)).toBeTruthy();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("cancelar a confirmacao nao grava e mantem o que estava marcado", async () => {
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
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Configuracoes salvas."));
  });

  it("com o HTTPS ja ligado, salvar outra coisa nao pede confirmacao", async () => {
    await abrir({ force_https: true });

    fireEvent.change(nome(), { target: { value: "Portal Best" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(screen.queryByText("Ligar o redirecionamento para HTTPS?")).toBeNull();
  });

  it("desligar o HTTPS salva sem pedir confirmacao", async () => {
    await abrir({ force_https: true });

    fireEvent.click(https());
    fireEvent.click(salvar());

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ force_https: false })));
    expect(screen.queryByText("Ligar o redirecionamento para HTTPS?")).toBeNull();
  });

  it("mudar so outra coisa com o HTTPS desligado tambem nao pede confirmacao", async () => {
    await abrir();

    fireEvent.change(email(), { target: { value: "novo@exemplo.com" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(screen.queryByText("Ligar o redirecionamento para HTTPS?")).toBeNull();
  });
});

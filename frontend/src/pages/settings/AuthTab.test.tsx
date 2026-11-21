import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as settingsApi from "../../api/settings";
import type { AppSettings } from "../../api/settings";
import AuthTab from "./AuthTab";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  settings: null as unknown,
  reload: vi.fn(),
}));

vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../context/BrandingContext", () => ({
  useBranding: () => ({ settings: mocks.settings, reload: mocks.reload }),
}));
vi.mock("../../api/settings", () => ({ updateSettings: vi.fn() }));

const updateSettings = vi.mocked(settingsApi.updateSettings);

const BASE = {
  allow_registration: true,
  google_oauth_enabled: false,
  google_client_id: null,
  google_client_secret_configured: false,
  google_allowed_domains: null,
} as unknown as AppSettings;

const salvar = () => screen.getByRole("button", { name: /^Salvar/ }) as HTMLButtonElement;
const editar = (nomeDaLinha: string) => fireEvent.click(screen.getByRole("button", { name: `Editar ${nomeDaLinha}` }));
const linha = (nomeDaLinha: string) => screen.getByText(nomeDaLinha).closest("li") as HTMLElement;
const clientId = () => screen.getByLabelText("Client ID") as HTMLInputElement;
const segredo = () => screen.getByLabelText("Client secret") as HTMLInputElement;
const dominios = () => screen.getByLabelText("Domínios permitidos") as HTMLInputElement;
const interruptorGoogle = () => screen.getByLabelText(/Habilitar login com Google/) as HTMLInputElement;
const interruptorConta = () => screen.getByLabelText(/Permitir criar conta/) as HTMLInputElement;

function abrir(settings: Partial<AppSettings> = {}) {
  mocks.settings = { ...BASE, ...settings };
  return render(<AuthTab />);
}

beforeEach(() => {
  mocks.showToast.mockClear();
  mocks.settings = { ...BASE };
  mocks.reload.mockReset();
  mocks.reload.mockResolvedValue(undefined);
  updateSettings.mockReset();
  updateSettings.mockImplementation(async (data) => {
    mocks.settings = { ...(mocks.settings as object), ...data };
    return mocks.settings as AppSettings;
  });
});

describe("AuthTab - a lista", () => {
  it("tem uma linha para a criação de conta e outra para o login com Google, e nada aberto", () => {
    abrir();

    expect(within(linha("Criação de conta")).getByRole("button", { name: "Editar Criação de conta" })).toBeTruthy();
    expect(within(linha("Login com Google")).getByRole("button", { name: "Editar Login com Google" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("mostra o estado de cada uma", () => {
    abrir();

    expect(within(linha("Criação de conta")).getByText("Permitida")).toBeTruthy();
    expect(within(linha("Login com Google")).getByText("Desligado")).toBeTruthy();
  });

  it("com o cadastro bloqueado e o Google ligado, mostra Bloqueada, Ligado e os domínios", () => {
    abrir({ allow_registration: false, google_oauth_enabled: true, google_allowed_domains: "empresa.com" } as Partial<AppSettings>);

    expect(within(linha("Criação de conta")).getByText("Bloqueada")).toBeTruthy();
    expect(within(linha("Login com Google")).getByText("Ligado")).toBeTruthy();
    expect(within(linha("Login com Google")).getByText("Domínios: empresa.com")).toBeTruthy();
  });

  it("com o Google ligado e sem domínios, diz que vale qualquer conta Google", () => {
    abrir({ google_oauth_enabled: true } as Partial<AppSettings>);

    expect(within(linha("Login com Google")).getByText("Qualquer conta Google")).toBeTruthy();
  });

  it("sem a marca carregada os botões de editar ficam desligados", () => {
    mocks.settings = null;
    render(<AuthTab />);

    expect((screen.getByRole("button", { name: "Editar Criação de conta" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AuthTab - criação de conta", () => {
  it("abre com o estado salvo e o Salvar desligado", () => {
    abrir();
    editar("Criação de conta");

    expect(interruptorConta().checked).toBe(true);
    expect(interruptorConta().getAttribute("role")).toBe("switch");
    expect(salvar().disabled).toBe(true);
  });

  it("desligar só vale depois de salvar", async () => {
    abrir();
    editar("Criação de conta");

    fireEvent.click(interruptorConta());
    expect(updateSettings).not.toHaveBeenCalled();
    fireEvent.click(salvar());

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ allow_registration: false }));
    expect(mocks.reload).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("Criação de conta desabilitada.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("ligar de novo avisa que foi habilitada", async () => {
    abrir({ allow_registration: false } as Partial<AppSettings>);
    editar("Criação de conta");

    fireEvent.click(interruptorConta());
    fireEvent.click(salvar());

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Criação de conta habilitada."));
  });

  it("falha ao salvar mostra o erro na janela e mantém a escolha", async () => {
    abrir();
    editar("Criação de conta");
    updateSettings.mockRejectedValueOnce(new Error("500"));

    fireEvent.click(interruptorConta());
    fireEvent.click(salvar());

    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível salvar.");
    expect(interruptorConta().checked).toBe(false);
  });
});

describe("AuthTab - login com Google", () => {
  it("abre com o que está salvo, sem mostrar o segredo, e o Salvar desligado", () => {
    abrir({ google_oauth_enabled: true, google_client_id: "abc.apps.googleusercontent.com", google_client_secret_configured: true, google_allowed_domains: "empresa.com" } as Partial<AppSettings>);
    editar("Login com Google");

    expect(interruptorGoogle().checked).toBe(true);
    expect(clientId().value).toBe("abc.apps.googleusercontent.com");
    expect(segredo().value).toBe("");
    expect(segredo().placeholder).toMatch(/Já configurado/);
    expect(dominios().value).toBe("empresa.com");
    expect(salvar().disabled).toBe(true);
  });

  it("Salvar sem digitar o segredo não o manda (o atual é mantido)", async () => {
    abrir({ google_client_id: "abc" } as Partial<AppSettings>);
    editar("Login com Google");

    fireEvent.click(interruptorGoogle());
    fireEvent.click(salvar());

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        google_oauth_enabled: true,
        google_client_id: "abc",
        google_allowed_domains: null,
      }),
    );
    expect(mocks.showToast).toHaveBeenCalledWith("Configurações de login com Google salvas.");
  });

  it("digitar só o segredo já liga o Salvar e o manda junto", async () => {
    abrir();
    editar("Login com Google");

    fireEvent.change(segredo(), { target: { value: "segredo-novo" } });
    expect(salvar().disabled).toBe(false);
    fireEvent.click(salvar());

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ google_client_secret: "segredo-novo" })));
  });

  it("campos vazios vão como nulo", async () => {
    abrir({ google_client_id: "abc", google_allowed_domains: "empresa.com" } as Partial<AppSettings>);
    editar("Login com Google");

    fireEvent.change(clientId(), { target: { value: "" } });
    fireEvent.change(dominios(), { target: { value: "" } });
    fireEvent.click(salvar());

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ google_oauth_enabled: false, google_client_id: null, google_allowed_domains: null }),
    );
  });

  it("falha ao salvar mostra o erro do servidor na janela e mantém o que foi digitado", async () => {
    abrir();
    editar("Login com Google");
    updateSettings.mockRejectedValueOnce({ response: { data: { detail: "Client ID inválido" } } });

    fireEvent.change(clientId(), { target: { value: "xyz" } });
    fireEvent.click(salvar());

    expect((await screen.findByRole("alert")).textContent).toBe("Client ID inválido");
    expect(clientId().value).toBe("xyz");
  });

  it("todo campo tem rótulo e dica ligados", () => {
    abrir();
    editar("Login com Google");

    for (const campo of [clientId(), segredo(), dominios()]) {
      expect(document.querySelector(`label[for="${campo.id}"]`)).not.toBeNull();
      expect(document.getElementById(campo.getAttribute("aria-describedby") ?? "")).not.toBeNull();
    }
    expect(document.querySelectorAll("label label")).toHaveLength(0);
  });
});

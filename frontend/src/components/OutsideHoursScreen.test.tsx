import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../api/auth";
import * as extensionsApi from "../api/accessExtensions";
import type { ExtensionRequest } from "../api/accessExtensions";
import type { AppSettings } from "../api/settings";
import { BrandingContext } from "../context/brandingContextObject";
import OutsideHoursScreen from "./OutsideHoursScreen";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { OUTSIDE_HOURS_EVENT, formatNextOpen, outsideHoursFrom } from "../utils/outsideHours";
import type { OutsideHoursInfo } from "../utils/outsideHours";

vi.mock("../api/auth", () => ({ me: vi.fn(), refreshSession: vi.fn(), login: vi.fn(), loginWithGoogle: vi.fn(), updateName: vi.fn(), changePassword: vi.fn() }));

vi.mock("../api/accessExtensions", () => ({ getMyRequest: vi.fn(), requestMoreTime: vi.fn() }));

const me = vi.mocked(authApi.me);
const getMyRequest = vi.mocked(extensionsApi.getMyRequest);
const requestMoreTime = vi.mocked(extensionsApi.requestMoreTime);

function pedido(extra: Partial<ExtensionRequest> = {}): ExtensionRequest {
  return {
    id: 1,
    user_id: 7,
    user_name: "Ana",
    user_email: "ana@x.com",
    reason: "Fechar o relatorio",
    status: "pending",
    created_at: "2026-11-21T13:00:00Z",
    decided_at: null,
    decided_by_name: null,
    note: null,
    grant_until: null,
    active: false,
    ...extra,
  };
}

const INFO: OutsideHoursInfo = {
  code: "outside_hours",
  message: "Você está fora do horário de acesso.",
  next_open: "2026-11-23T08:00:00-03:00",
  windows: ["Seg a Sex, 08:00 às 18:00"],
  timezone: "America/Sao_Paulo",
};

function App() {
  const { user } = useAuth();
  return <p>{user ? `logada: ${user.name}` : "sem usuario"}</p>;
}

beforeEach(() => {
  getMyRequest.mockReset();
  requestMoreTime.mockReset();
  getMyRequest.mockResolvedValue(null);
  me.mockReset();
  localStorage.clear();
  localStorage.setItem("token", "abc");
});

describe("outsideHoursFrom", () => {
  it("so reconhece o 403 com codigo outside_hours", () => {
    expect(outsideHoursFrom({ response: { status: 403, data: { detail: INFO } } })).toEqual(INFO);
    expect(outsideHoursFrom({ response: { status: 403, data: { detail: "Sem permissao" } } })).toBeNull();
    expect(outsideHoursFrom({ response: { status: 401, data: { detail: INFO } } })).toBeNull();
    expect(outsideHoursFrom(new Error("rede"))).toBeNull();
  });

  it("escreve quando o acesso volta no fuso do sistema", () => {
    expect(formatNextOpen(INFO)).toMatch(/segunda-feira/i);
    expect(formatNextOpen(INFO)).toContain("08:00");
    expect(formatNextOpen({ ...INFO, next_open: null })).toBeNull();
  });
});

describe("AuthProvider fora do horario", () => {
  it("o aviso troca o app inteiro, com o horario e quando volta, sem apagar a sessao", async () => {
    me.mockResolvedValue({ id: 1, name: "Ana", email: "a@x.com" } as never);
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    await screen.findByText("logada: Ana");

    window.dispatchEvent(new CustomEvent(OUTSIDE_HOURS_EVENT, { detail: INFO }));

    expect(await screen.findByText("Fora do horário de acesso")).toBeTruthy();
    expect(screen.getByText("Seg a Sex, 08:00 às 18:00")).toBeTruthy();
    expect(screen.getByText(/O seu acesso volta em segunda-feira/i)).toBeTruthy();
    expect(screen.queryByText("logada: Ana")).toBeNull();
    expect(localStorage.getItem("token")).toBe("abc");
  });

  it("tentar de novo volta ao app quando o horario abriu", async () => {
    me.mockResolvedValueOnce({ id: 1, name: "Ana", email: "a@x.com" } as never);
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    await screen.findByText("logada: Ana");
    window.dispatchEvent(new CustomEvent(OUTSIDE_HOURS_EVENT, { detail: INFO }));
    await screen.findByText("Fora do horário de acesso");

    me.mockResolvedValueOnce({ id: 1, name: "Ana", email: "a@x.com" } as never);
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => expect(screen.getByText("logada: Ana")).toBeTruthy());
    expect(screen.queryByText("Fora do horário de acesso")).toBeNull();
  });

  it("ao abrir o app fora do horario, o token fica e o aviso aparece", async () => {
    me.mockImplementation(async () => {
      window.dispatchEvent(new CustomEvent(OUTSIDE_HOURS_EVENT, { detail: INFO }));
      throw { response: { status: 403, data: { detail: INFO } } };
    });
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );

    expect(await screen.findByText("Fora do horário de acesso")).toBeTruthy();
    expect(localStorage.getItem("token")).toBe("abc");
  });
});

describe("OutsideHoursScreen - pedir mais tempo", () => {
  const abrir = (extra: Partial<React.ComponentProps<typeof OutsideHoursScreen>> = {}) =>
    render(<OutsideHoursScreen info={INFO} onRetry={vi.fn()} onLeave={vi.fn()} pollMs={20} {...extra} />);

  it("sem pedido aberto mostra o campo do motivo e o botao so liga com o motivo escrito", async () => {
    abrir();
    const botao = (await screen.findByRole("button", { name: "Pedir mais tempo" })) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Motivo do pedido"), { target: { value: "ab" } });
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo do pedido"), { target: { value: "Preciso fechar o mes" } });
    expect(botao.disabled).toBe(false);
  });

  it("envia o pedido e passa a mostrar que esta aguardando", async () => {
    requestMoreTime.mockResolvedValue(pedido({ reason: "Preciso fechar o mes" }));
    abrir();
    fireEvent.change(await screen.findByLabelText("Motivo do pedido"), { target: { value: "  Preciso fechar o mes  " } });
    fireEvent.click(screen.getByRole("button", { name: "Pedir mais tempo" }));

    await waitFor(() => expect(requestMoreTime).toHaveBeenCalledWith("Preciso fechar o mes"));
    expect(await screen.findByText("Pedido enviado")).toBeTruthy();
    expect(screen.queryByLabelText("Motivo do pedido")).toBeNull();
  });

  it("mostra a mensagem do servidor quando o pedido falha", async () => {
    requestMoreTime.mockRejectedValue({ response: { data: { detail: "Você está dentro do horário de acesso." } } });
    abrir();
    fireEvent.change(await screen.findByLabelText("Motivo do pedido"), { target: { value: "Preciso fechar o mes" } });
    fireEvent.click(screen.getByRole("button", { name: "Pedir mais tempo" }));

    expect(await screen.findByText("Você está dentro do horário de acesso.")).toBeTruthy();
  });

  it("com pedido aberto ao abrir a tela, ja mostra aguardando", async () => {
    getMyRequest.mockResolvedValue(pedido());
    abrir();

    expect(await screen.findByText("Pedido enviado")).toBeTruthy();
    expect(screen.getByText(/Fechar o relatorio/)).toBeTruthy();
  });

  it("entra sozinha quando o pedido e aprovado", async () => {
    const onRetry = vi.fn();
    getMyRequest.mockResolvedValueOnce(pedido()).mockResolvedValue(pedido({ status: "approved", active: true, grant_until: "2026-11-21T15:00:00Z" }));
    abrir({ onRetry });

    await waitFor(() => expect(onRetry).toHaveBeenCalled());
  });

  it("pedido recusado mostra quem recusou e o motivo, e deixa pedir de novo", async () => {
    getMyRequest.mockResolvedValue(pedido({ status: "denied", decided_by_name: "MARIA DA SILVA", note: "Fecha amanha" }));
    abrir();

    expect(await screen.findByText(/recusado por Maria da Silva: Fecha amanha/)).toBeTruthy();
    expect(screen.getByLabelText("Motivo do pedido")).toBeTruthy();
  });

  it("liberacao que ja acabou nao entra sozinha e deixa pedir de novo", async () => {
    const onRetry = vi.fn();
    getMyRequest.mockResolvedValue(pedido({ status: "approved", active: false, grant_until: "2026-11-21T14:00:00Z" }));
    abrir({ onRetry });

    expect(await screen.findByText("A liberação do seu último pedido terminou.")).toBeTruthy();
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe("OutsideHoursScreen - marca e textos personalizados", () => {
  function comMarca(settings: Partial<AppSettings> | null) {
    return render(
      <BrandingContext.Provider value={{ settings: settings as AppSettings | null, loaded: true, reload: async () => undefined }}>
        <OutsideHoursScreen info={INFO} onRetry={vi.fn()} onLeave={vi.fn()} pollMs={20} />
      </BrandingContext.Provider>,
    );
  }

  it("sem personalização mostra os textos de sempre e a logo padrão", async () => {
    const { container } = comMarca({});

    expect(await screen.findByText("Fora do horário de acesso")).toBeTruthy();
    expect(screen.getByText(/O seu acesso volta em segunda-feira/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
    expect(container.querySelector("img[src*='/static/uploads/']")).toBeNull();
    expect(container.querySelector(".auth-logo")).not.toBeNull();
  });

  it("mostra a logo da marca", async () => {
    const { container } = comMarca({ logo_url: "/static/uploads/minha-marca.png" });
    await screen.findByText("Fora do horário de acesso");

    const logo = container.querySelector("img.auth-logo") as HTMLImageElement;
    expect(logo.getAttribute("src")).toContain("minha-marca.png");
  });

  it("título e botão personalizados trocam os de sempre", async () => {
    comMarca({ outside_hours_title: "Volte no seu horário", outside_hours_button: "Verificar de novo" });

    expect(await screen.findByText("Volte no seu horário")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verificar de novo" })).toBeTruthy();
    expect(screen.queryByText("Fora do horário de acesso")).toBeNull();
  });

  it("mensagem personalizada vem primeiro e a linha de quando o acesso volta continua abaixo", async () => {
    comMarca({ outside_hours_message: "Seu acesso é só em horário comercial." });

    expect(await screen.findByText("Seu acesso é só em horário comercial.")).toBeTruthy();
    expect(screen.getByText(/O seu acesso volta em segunda-feira/i)).toBeTruthy();
  });

  it("o horário permitido e o pedido de mais tempo aparecem mesmo com tudo personalizado", async () => {
    comMarca({ outside_hours_title: "T", outside_hours_message: "M", outside_hours_button: "B" });

    expect(await screen.findByText("Seg a Sex, 08:00 às 18:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pedir mais tempo" })).toBeTruthy();
  });
});

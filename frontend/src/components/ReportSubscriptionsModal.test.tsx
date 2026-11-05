import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as deliveryApi from "../api/reportDelivery";
import * as api from "../api/subscriptions";
import type { Subscription } from "../api/subscriptions";
import { makeReport } from "../test-fixtures";
import ReportSubscriptionsModal from "./ReportSubscriptionsModal";

vi.mock("../api/subscriptions");
vi.mock("../api/reportDelivery", () => ({ getDeliveryStatus: vi.fn() }));

const listar = vi.mocked(api.listReportSubscriptions);
const criar = vi.mocked(api.createSubscription);
const atualizar = vi.mocked(api.updateSubscription);
const excluir = vi.mocked(api.deleteSubscription);
const enviarAgora = vi.mocked(api.runSubscriptionNow);
const historico = vi.mocked(api.listSubscriptionRuns);
const andamento = vi.mocked(deliveryApi.getDeliveryStatus);
const RELATORIO = makeReport(34, { name: "Vendas Mensal" });

function assinatura(extra: Partial<Subscription> = {}): Subscription {
  return {
    id: 7,
    report_id: 34,
    report_name: "Vendas Mensal",
    collection_id: 3,
    collection_name: "Comercial",
    name: null,
    recipients: ["a@empresa.com", "b@empresa.com"],
    format: "PDF",
    days: [0, 2, 4],
    times: ["08:00"],
    schedule_text: "seg, qua, sex as 08:00",
    timezone: "America/Sao_Paulo",
    start_date: null,
    end_date: null,
    subject: null,
    message: null,
    enabled: true,
    next_run_at: "2026-11-05T11:00:00Z",
    last_run_at: null,
    last_status: null,
    last_message: null,
    consecutive_failures: 0,
    created_by_name: "Armando",
    created_at: "2026-11-04T10:00:00Z",
    ...extra,
  };
}

async function abrir(domains: string[] = [], onClose = vi.fn()) {
  render(<ReportSubscriptionsModal report={RELATORIO} workspaceId={3} allowedDomains={domains} onClose={onClose} />);
  screen.getByRole("dialog");
  return onClose;
}

beforeEach(() => {
  vi.resetAllMocks();
  listar.mockResolvedValue([]);
});

describe("ReportSubscriptionsModal - lista", () => {
  it("avisa quando o relatorio ainda nao tem assinatura", async () => {
    await abrir();

    expect(await screen.findByText("Nenhuma assinatura neste relatorio ainda.")).toBeTruthy();
    expect(listar).toHaveBeenCalledWith(3, 34);
  });

  it("mostra horario, destinatarios, formato e o proximo envio", async () => {
    listar.mockResolvedValue([assinatura()]);
    await abrir();

    expect(await screen.findByText("seg, qua, sex as 08:00")).toBeTruthy();
    expect(screen.getByText(/2 destinatario\(s\)/)).toBeTruthy();
    expect(screen.getByText(/proximo envio/)).toBeTruthy();
    expect(screen.getByText("Ativa")).toBeTruthy();
    expect(screen.getByText("PDF")).toBeTruthy();
  });

  it("assinatura pausada nao mostra proximo envio", async () => {
    listar.mockResolvedValue([assinatura({ enabled: false, next_run_at: null })]);
    await abrir();

    expect(await screen.findByText("Pausada")).toBeTruthy();
    expect(screen.queryByText(/proximo envio/)).toBeNull();
    expect(screen.getByRole("button", { name: "Reativar" })).toBeTruthy();
  });

  it("mostra o motivo quando o ultimo envio falhou", async () => {
    listar.mockResolvedValue([assinatura({ last_status: "error", last_message: "O servidor recusou a senha" })]);
    await abrir();

    expect(await screen.findByText(/Ultimo envio falhou: O servidor recusou a senha/)).toBeTruthy();
  });

  it("mostra o erro quando a lista nao carrega", async () => {
    listar.mockRejectedValue(new Error("rede"));
    await abrir();

    expect(await screen.findByText("Nao foi possivel carregar as assinaturas.")).toBeTruthy();
  });
});

describe("ReportSubscriptionsModal - criar", () => {
  async function abrirFormulario(domains: string[] = []) {
    await abrir(domains);
    fireEvent.click(await screen.findByRole("button", { name: "Nova assinatura" }));
  }

  it("cria com destinatarios limpos, dias e horarios escolhidos", async () => {
    criar.mockResolvedValue(assinatura());
    await abrirFormulario();
    fireEvent.change(screen.getByLabelText("Destinatarios"), {
      target: { value: "A@Empresa.com, b@empresa.com;\n a@empresa.com" },
    });
    fireEvent.change(screen.getByLabelText("Formato"), { target: { value: "PNG" } });
    fireEvent.click(screen.getByLabelText("Sex")); // desmarca a sexta (vem marcada)
    fireEvent.click(screen.getByLabelText("Dom"));
    fireEvent.change(screen.getByLabelText("Horario 1"), { target: { value: "09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar horario" }));
    fireEvent.change(screen.getByLabelText("Horario 2"), { target: { value: "07:00" } });
    fireEvent.change(screen.getByLabelText("Assunto (opcional)"), { target: { value: " Vendas " } });

    fireEvent.click(screen.getByRole("button", { name: "Criar assinatura" }));

    await waitFor(() => expect(criar).toHaveBeenCalledTimes(1));
    expect(criar).toHaveBeenCalledWith(3, 34, {
      name: null,
      recipients: ["a@empresa.com", "b@empresa.com"],
      format: "PNG",
      days: [0, 1, 2, 3, 6],
      times: ["07:00", "09:30"],
      timezone: null,
      start_date: null,
      end_date: null,
      subject: "Vendas",
      message: null,
    });
    // volta para a lista, recarregada
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Nova assinatura" })).toBeTruthy();
  });

  it("nao envia sem destinatario, sem dia ou sem horario", async () => {
    await abrirFormulario();

    fireEvent.click(screen.getByRole("button", { name: "Criar assinatura" }));
    expect(screen.getByRole("alert").textContent).toContain("destinatario");

    fireEvent.change(screen.getByLabelText("Destinatarios"), { target: { value: "a@empresa.com" } });
    for (const dia of ["Seg", "Ter", "Qua", "Qui", "Sex"]) fireEvent.click(screen.getByLabelText(dia));
    fireEvent.click(screen.getByRole("button", { name: "Criar assinatura" }));
    expect(screen.getByRole("alert").textContent).toContain("dia da semana");

    fireEvent.click(screen.getByLabelText("Seg"));
    fireEvent.change(screen.getByLabelText("Horario 1"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar assinatura" }));
    expect(screen.getByRole("alert").textContent).toContain("horario");

    expect(criar).not.toHaveBeenCalled();
  });

  it("recusa data final antes da inicial", async () => {
    await abrirFormulario();
    fireEvent.change(screen.getByLabelText("Destinatarios"), { target: { value: "a@empresa.com" } });
    fireEvent.change(screen.getByLabelText("Comeca em (opcional)"), { target: { value: "2026-12-10" } });
    fireEvent.change(screen.getByLabelText("Termina em (opcional)"), { target: { value: "2026-12-01" } });

    fireEvent.click(screen.getByRole("button", { name: "Criar assinatura" }));

    expect(screen.getByRole("alert").textContent).toContain("data final");
    expect(criar).not.toHaveBeenCalled();
  });

  it("mostra os dominios aceitos quando ha lista", async () => {
    await abrirFormulario(["empresa.com", "outra.com.br"]);

    expect(screen.getByText(/empresa.com, outra.com.br/)).toBeTruthy();
  });

  it("mostra o erro do servidor e continua no formulario", async () => {
    criar.mockRejectedValue({ response: { data: { detail: "Destinatario fora dos dominios permitidos" } } });
    await abrirFormulario();
    fireEvent.change(screen.getByLabelText("Destinatarios"), { target: { value: "a@fora.com" } });

    fireEvent.click(screen.getByRole("button", { name: "Criar assinatura" }));

    expect((await screen.findByRole("alert")).textContent).toContain("fora dos dominios");
    expect(screen.getByRole("button", { name: "Criar assinatura" })).toBeTruthy();
  });

  it("nao deixa passar de 6 horarios", async () => {
    await abrirFormulario();
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Adicionar horario" }));

    expect(screen.queryByRole("button", { name: "Adicionar horario" })).toBeNull();
    expect(screen.getByLabelText("Horario 6")).toBeTruthy();
  });
});

describe("ReportSubscriptionsModal - gerenciar", () => {
  it("editar abre o formulario preenchido e salva o que foi mudado", async () => {
    listar.mockResolvedValue([assinatura()]);
    atualizar.mockResolvedValue(assinatura());
    await abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));

    expect((screen.getByLabelText("Destinatarios") as HTMLTextAreaElement).value).toBe("a@empresa.com\nb@empresa.com");
    fireEvent.change(screen.getByLabelText("Horario 1"), { target: { value: "10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(atualizar).toHaveBeenCalledTimes(1));
    expect(atualizar.mock.calls[0][0]).toBe(3);
    expect(atualizar.mock.calls[0][1]).toBe(7);
    expect(atualizar.mock.calls[0][2]?.times).toEqual(["10:00"]);
  });

  it("pausar manda enabled false e recarrega", async () => {
    listar.mockResolvedValue([assinatura()]);
    atualizar.mockResolvedValue(assinatura({ enabled: false }));
    await abrir();

    fireEvent.click(await screen.findByRole("button", { name: "Pausar" }));

    await waitFor(() => expect(atualizar).toHaveBeenCalledWith(3, 7, { enabled: false }));
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));
  });

  it("reativar mostra o motivo quando o servidor recusa", async () => {
    listar.mockResolvedValue([assinatura({ enabled: false })]);
    atualizar.mockRejectedValue({ response: { data: { detail: "O relatorio agora usa RLS" } } });
    await abrir();

    fireEvent.click(await screen.findByRole("button", { name: "Reativar" }));

    expect((await screen.findByRole("alert")).textContent).toContain("RLS");
  });

  it("excluir pede confirmacao e so apaga depois dela", async () => {
    listar.mockResolvedValue([assinatura()]);
    excluir.mockResolvedValue();
    await abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }));

    expect(excluir).not.toHaveBeenCalled();
    const dialogo = screen.getAllByRole("dialog").at(-1) as HTMLElement;
    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(excluir).toHaveBeenCalledWith(3, 7));
  });

  it("cancelar a exclusao nao apaga nada", async () => {
    listar.mockResolvedValue([assinatura()]);
    await abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    const dialogo = screen.getAllByRole("dialog").at(-1) as HTMLElement;

    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    expect(excluir).not.toHaveBeenCalled();
  });

  it("o historico lista os envios com o motivo das falhas", async () => {
    listar.mockResolvedValue([assinatura()]);
    historico.mockResolvedValue([
      {
        id: 2,
        started_at: "2026-11-04T11:00:00Z",
        finished_at: null,
        status: "error",
        trigger: "schedule",
        attempts: 3,
        message: "Servidor de e-mail fora do ar",
        recipients_count: 2,
      },
      {
        id: 1,
        started_at: "2026-11-03T11:00:00Z",
        finished_at: null,
        status: "ok",
        trigger: "manual",
        attempts: 1,
        message: null,
        recipients_count: 2,
      },
    ]);
    await abrir();

    fireEvent.click(await screen.findByRole("button", { name: "Historico" }));

    expect(await screen.findByText(/Falhou: Servidor de e-mail fora do ar/)).toBeTruthy();
    expect(screen.getByText(/Enviado \(manual\)/)).toBeTruthy();
    expect(historico).toHaveBeenCalledWith(3, 7);
  });
});

describe("ReportSubscriptionsModal - enviar agora", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listar.mockResolvedValue([assinatura()]);
    enviarAgora.mockResolvedValue("job-9");
    andamento.mockResolvedValue({ status: "exporting", message: "Exportando o relatorio no Power BI...", progress: 20 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function avancar(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("acompanha o andamento e recarrega a lista quando termina", async () => {
    await abrir();
    await avancar();
    fireEvent.click(screen.getByRole("button", { name: "Enviar agora" }));
    await avancar();

    expect(enviarAgora).toHaveBeenCalledWith(3, 7);
    expect(screen.getByRole("status").textContent).toBe("Exportando o relatorio no Power BI...");

    andamento.mockResolvedValue({ status: "done", message: "Enviado", progress: 100 });
    await avancar(2000);

    expect(screen.queryByRole("status")).toBeNull();
    expect(listar).toHaveBeenCalledTimes(2);
  });

  it("mostra o erro quando o servidor recusa o envio (ex: ja esta enviando)", async () => {
    enviarAgora.mockRejectedValue({ response: { data: { detail: "Esta assinatura ja esta sendo enviada" } } });
    await abrir();
    await avancar();

    fireEvent.click(screen.getByRole("button", { name: "Enviar agora" }));
    await avancar();

    expect(screen.getByRole("alert").textContent).toContain("ja esta sendo enviada");
  });
});

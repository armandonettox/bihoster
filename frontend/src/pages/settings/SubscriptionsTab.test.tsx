import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as emailApi from "../../api/emailSettings";
import * as powerbiApi from "../../api/powerbi";
import * as reportsApi from "../../api/reports";
import * as api from "../../api/subscriptions";
import type { Subscription } from "../../api/subscriptions";
import { makeReport } from "../../test-fixtures";
import SubscriptionsTab from "./SubscriptionsTab";

vi.mock("../../api/subscriptions");
vi.mock("../../api/emailSettings", () => ({ getEmailStatus: vi.fn() }));
vi.mock("../../api/powerbi", () => ({ listPowerBIPages: vi.fn() }));
vi.mock("../../api/reports", () => ({ getReport: vi.fn() }));
vi.mock("../../api/reportDelivery", () => ({ getDeliveryStatus: vi.fn() }));
vi.mock("../../context/BrandingContext", () => ({ useBranding: () => ({ settings: { timezone: "UTC" } }) }));

const listar = vi.mocked(api.listAllSubscriptions);
const relatorios = vi.mocked(api.listReportsForNewSubscription);
const criar = vi.mocked(api.createSubscription);
const atualizar = vi.mocked(api.updateSubscription);
const excluir = vi.mocked(api.deleteSubscription);
const enviarAgora = vi.mocked(api.runSubscriptionNow);

function assinatura(extra: Partial<Subscription> = {}): Subscription {
  return {
    id: 7,
    report_id: 34,
    report_name: "Vendas Mensal",
    collection_id: 3,
    collection_name: "Comercial",
    name: "Resumo da manha",
    recipients: ["a@empresa.com"],
    format: "PDF",
    days: [0, 1, 2, 3, 4],
    times: ["08:00"],
    schedule_text: "Seg a Sex as 08:00",
    timezone: "America/Sao_Paulo",
    start_date: null,
    end_date: null,
    subject: null,
    message: null,
    page_names: [],
    enabled: true,
    next_run_at: null,
    last_run_at: null,
    last_status: null,
    last_message: null,
    consecutive_failures: 0,
    created_by_name: "Armando",
    created_at: "2026-11-04T10:00:00Z",
    can_edit: true,
    can_delete: true,
    can_run: true,
    ...extra,
  };
}

const ESCOLHA = { report_id: 34, report_name: "Vendas Mensal", collection_id: 3, collection_name: "Comercial" };

beforeEach(() => {
  vi.resetAllMocks();
  listar.mockResolvedValue([assinatura()]);
  relatorios.mockResolvedValue([ESCOLHA]);
  vi.mocked(emailApi.getEmailStatus).mockResolvedValue({ configured: true, allowed_domains: [] });
  vi.mocked(reportsApi.getReport).mockResolvedValue(makeReport(34, { name: "Vendas Mensal" }));
  vi.mocked(powerbiApi.listPowerBIPages).mockResolvedValue([]);
});

describe("modulo Assinaturas", () => {
  it("lista as assinaturas de todas as colecoes com o resumo", async () => {
    listar.mockResolvedValue([assinatura(), assinatura({ id: 8, collection_name: "RH", enabled: false })]);
    render(<SubscriptionsTab />);

    expect(await screen.findByText("Comercial")).toBeTruthy();
    expect(screen.getByText("RH")).toBeTruthy();
    expect(screen.getByText(/2 assinatura\(s\), 1 ativa\(s\)/)).toBeTruthy();
  });

  it("so mostra as acoes que o servidor permite", async () => {
    listar.mockResolvedValue([assinatura({ can_edit: false, can_delete: false, can_run: false })]);
    render(<SubscriptionsTab />);
    await screen.findByText("Comercial");

    expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Excluir/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Enviar agora/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pausar/ })).toBeNull();
  });

  it("pausa pela colecao da assinatura e recarrega", async () => {
    atualizar.mockResolvedValue(assinatura({ enabled: false }));
    render(<SubscriptionsTab />);
    await screen.findByText("Comercial");

    fireEvent.click(screen.getByRole("button", { name: "Pausar Resumo da manha" }));

    await waitFor(() => expect(atualizar).toHaveBeenCalledWith(3, 7, { enabled: false }));
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));
  });

  it("exclui so depois de confirmar", async () => {
    excluir.mockResolvedValue();
    render(<SubscriptionsTab />);
    await screen.findByText("Comercial");

    fireEvent.click(screen.getByRole("button", { name: "Excluir Resumo da manha" }));
    expect(excluir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(excluir).toHaveBeenCalledWith(3, 7));
  });

  it("enviar agora dispara o envio pela colecao da assinatura", async () => {
    enviarAgora.mockResolvedValue("job-1");
    render(<SubscriptionsTab />);
    await screen.findByText("Comercial");

    fireEvent.click(screen.getByRole("button", { name: "Enviar agora Resumo da manha" }));

    await waitFor(() => expect(enviarAgora).toHaveBeenCalledWith(3, 7));
  });

  it("edita uma assinatura: abre o formulario e salva pela colecao", async () => {
    atualizar.mockResolvedValue(assinatura());
    render(<SubscriptionsTab />);
    await screen.findByText("Comercial");

    fireEvent.click(screen.getByRole("button", { name: "Editar Resumo da manha" }));
    await screen.findByText("Editar assinatura");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(atualizar).toHaveBeenCalledTimes(1));
    expect(atualizar.mock.calls[0][0]).toBe(3);
    expect(atualizar.mock.calls[0][1]).toBe(7);
    expect(atualizar.mock.calls[0][2]).toMatchObject({ recipients: ["a@empresa.com"] });
  });

  it("cria uma assinatura nova: escolhe o relatorio e envia para a colecao dele", async () => {
    criar.mockResolvedValue(assinatura());
    render(<SubscriptionsTab />);
    await screen.findByText("Comercial");

    fireEvent.click(screen.getByRole("button", { name: "Nova assinatura" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "34" } });
    await waitFor(() => expect(reportsApi.getReport).toHaveBeenCalledWith(3, 34));
    fireEvent.change(await screen.findByLabelText(/Destinatarios/), { target: { value: "gestor@empresa.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar assinatura" }));

    await waitFor(() => expect(criar).toHaveBeenCalledTimes(1));
    expect(criar.mock.calls[0][0]).toBe(3);
    expect(criar.mock.calls[0][1]).toBe(34);
    expect(criar.mock.calls[0][2]).toMatchObject({ recipients: ["gestor@empresa.com"] });
  });

  it("sem relatorio onde criar, o botao Nova assinatura nao aparece", async () => {
    relatorios.mockResolvedValue([]);
    render(<SubscriptionsTab />);
    await screen.findByText("Comercial");

    expect(screen.queryByRole("button", { name: "Nova assinatura" })).toBeNull();
  });

  it("mostra a mensagem quando a lista nao carrega", async () => {
    listar.mockRejectedValue(new Error("falhou"));
    render(<SubscriptionsTab />);

    expect(await screen.findByText("Nao foi possivel carregar as assinaturas.")).toBeTruthy();
  });
});

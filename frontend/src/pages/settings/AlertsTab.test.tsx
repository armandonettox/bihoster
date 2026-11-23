import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/alerts";
import type { Alert } from "../../api/alerts";
import AlertsTab from "./AlertsTab";

vi.mock("../../api/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/alerts")>()),
  listAllAlerts: vi.fn(),
  listReportsForNewAlert: vi.fn(),
  listReportMeasures: vi.fn(),
  createAlert: vi.fn(),
  updateAlert: vi.fn(),
  deleteAlert: vi.fn(),
}));
vi.mock("../../context/BrandingContext", () => ({ useBranding: () => ({ settings: { timezone: "UTC" } }) }));

const listar = vi.mocked(api.listAllAlerts);
const relatorios = vi.mocked(api.listReportsForNewAlert);
const medidas = vi.mocked(api.listReportMeasures);
const criar = vi.mocked(api.createAlert);
const atualizar = vi.mocked(api.updateAlert);
const excluir = vi.mocked(api.deleteAlert);

function alerta(extra: Partial<Alert> = {}): Alert {
  return {
    id: 5,
    report_id: 34,
    report_name: "Vendas Mensal",
    collection_id: 3,
    collection_name: "Comercial",
    created_by_name: "Armando",
    name: "Meta batida",
    measure_name: "Total",
    table_name: null,
    condition: ">",
    threshold: 10,
    recipients: ["a@empresa.com"],
    subject: null,
    message: null,
    check_interval_minutes: 60,
    cooldown_hours: 24,
    enabled: true,
    last_checked_at: null,
    last_triggered_at: null,
    last_value: null,
    last_status: null,
    last_message: null,
    created_at: "2026-11-04T10:00:00Z",
    can_edit: true,
    can_delete: true,
    ...extra,
  };
}

const ESCOLHA = { report_id: 34, report_name: "Vendas Mensal", collection_id: 3, collection_name: "Comercial" };

beforeEach(() => {
  vi.resetAllMocks();
  listar.mockResolvedValue([alerta()]);
  relatorios.mockResolvedValue([ESCOLHA]);
  medidas.mockResolvedValue([{ measure_name: "Total", table_name: "Vendas" }]);
});

describe("modulo Alertas", () => {
  it("lista os alertas de todas as colecoes com o resumo", async () => {
    listar.mockResolvedValue([alerta(), alerta({ id: 6, name: "Outro", enabled: false, collection_name: "RH" })]);
    render(<AlertsTab />);

    expect(await screen.findByText("Meta batida")).toBeTruthy();
    expect(screen.getByText("RH")).toBeTruthy();
    expect(screen.getByText(/2 alerta\(s\), 1 ativo\(s\)/)).toBeTruthy();
  });

  it("filtra pelo texto digitado", async () => {
    listar.mockResolvedValue([alerta(), alerta({ id: 6, name: "Outro", collection_name: "RH" })]);
    render(<AlertsTab />);
    await screen.findByText("Meta batida");

    fireEvent.change(screen.getByPlaceholderText(/Filtrar/), { target: { value: "RH" } });

    expect(screen.queryByText("Meta batida")).toBeNull();
    expect(screen.getByText("Outro")).toBeTruthy();
  });

  it("so mostra editar e excluir quando o servidor permite", async () => {
    listar.mockResolvedValue([alerta({ can_edit: false, can_delete: false })]);
    render(<AlertsTab />);
    await screen.findByText("Meta batida");

    expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Excluir/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pausar/ })).toBeNull();
  });

  it("pausa um alerta pela colecao dele e recarrega a lista", async () => {
    atualizar.mockResolvedValue(alerta({ enabled: false }));
    render(<AlertsTab />);
    await screen.findByText("Meta batida");

    fireEvent.click(screen.getByRole("button", { name: "Pausar Meta batida" }));

    await waitFor(() => expect(atualizar).toHaveBeenCalledWith(3, 5, { enabled: false }));
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));
  });

  it("exclui so depois de confirmar", async () => {
    excluir.mockResolvedValue();
    render(<AlertsTab />);
    await screen.findByText("Meta batida");

    fireEvent.click(screen.getByRole("button", { name: "Excluir Meta batida" }));
    expect(excluir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(excluir).toHaveBeenCalledWith(3, 5));
  });

  it("edita um alerta: abre o formulario com os dados e salva pela colecao", async () => {
    atualizar.mockResolvedValue(alerta());
    render(<AlertsTab />);
    await screen.findByText("Meta batida");

    fireEvent.click(screen.getByRole("button", { name: "Editar Meta batida" }));
    await screen.findByText("Editar alerta");
    fireEvent.change(screen.getByLabelText(/Valor limite/), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(atualizar).toHaveBeenCalledTimes(1));
    expect(atualizar.mock.calls[0][0]).toBe(3);
    expect(atualizar.mock.calls[0][1]).toBe(5);
    expect(atualizar.mock.calls[0][2]).toMatchObject({ threshold: 99, measure_name: "Total" });
  });

  it("cria um alerta novo: escolhe o relatorio, preenche e envia para a colecao dele", async () => {
    criar.mockResolvedValue(alerta());
    render(<AlertsTab />);
    await screen.findByText("Meta batida");

    fireEvent.click(screen.getByRole("button", { name: "Novo alerta" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "34" } });
    await waitFor(() => expect(medidas).toHaveBeenCalledWith(3, 34));
    await screen.findByText("Vendas / Total");
    fireEvent.change(screen.getByLabelText(/Destinatarios/), { target: { value: "gestor@empresa.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar alerta" }));

    await waitFor(() => expect(criar).toHaveBeenCalledTimes(1));
    expect(criar.mock.calls[0][0]).toBe(3);
    expect(criar.mock.calls[0][1]).toBe(34);
    expect(criar.mock.calls[0][2]).toMatchObject({ measure_name: "Total", recipients: ["gestor@empresa.com"] });
  });

  it("sem como listar as medidas, deixa digitar o nome da medida", async () => {
    medidas.mockRejectedValue(new Error("falhou"));
    criar.mockResolvedValue(alerta());
    render(<AlertsTab />);
    await screen.findByText("Meta batida");

    fireEvent.click(screen.getByRole("button", { name: "Novo alerta" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "34" } });
    const campo = await screen.findByLabelText("Nome da medida");
    fireEvent.change(campo, { target: { value: "Faturamento" } });
    fireEvent.change(screen.getByLabelText(/Destinatarios/), { target: { value: "gestor@empresa.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar alerta" }));

    await waitFor(() => expect(criar).toHaveBeenCalledTimes(1));
    expect(criar.mock.calls[0][2]).toMatchObject({ measure_name: "Faturamento" });
  });

  it("sem relatorio onde criar, o botao Novo alerta nao aparece", async () => {
    relatorios.mockResolvedValue([]);
    render(<AlertsTab />);
    await screen.findByText("Meta batida");

    expect(screen.queryByRole("button", { name: "Novo alerta" })).toBeNull();
  });

  it("mostra a mensagem quando a lista nao carrega", async () => {
    listar.mockRejectedValue(new Error("falhou"));
    render(<AlertsTab />);

    expect(await screen.findByText("Nao foi possivel carregar os alertas.")).toBeTruthy();
  });
});

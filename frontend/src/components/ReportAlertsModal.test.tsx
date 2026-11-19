import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api/alerts";
import type { Alert } from "../api/alerts";
import { makeReport } from "../test-fixtures";
import ReportAlertsModal from "./ReportAlertsModal";

vi.mock("../api/alerts");

const listar = vi.mocked(api.listReportAlerts);
const RELATORIO = makeReport(34, { name: "Vendas Mensal" });
const embedRef = { current: null };

function alerta(extra: Partial<Alert> = {}): Alert {
  return {
    id: 5,
    report_id: 34,
    report_name: "Vendas Mensal",
    collection_id: 3,
    collection_name: "Comercial",
    created_by_name: "Armando",
    name: null,
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
    ...extra,
  };
}

function abrir() {
  render(<ReportAlertsModal report={RELATORIO} workspaceId={3} embedRef={embedRef} can={{ create: true, edit: true, delete: true }} onClose={vi.fn()} />);
}

const botao = (nome: string) => screen.queryByRole("button", { name: nome });

beforeEach(() => {
  vi.resetAllMocks();
  listar.mockResolvedValue([]);
});

describe("ReportAlertsModal - o que cada alerta permite a quem olha", () => {
  it("alerta de outra pessoa, sem as permissoes de outras, nao mostra pausar, editar nem excluir", async () => {
    listar.mockResolvedValue([alerta({ can_edit: false, can_delete: false })]);
    abrir();
    await screen.findByText(/1 destinatario\(s\)/);

    expect(botao("Pausar")).toBeNull();
    expect(botao("Editar")).toBeNull();
    expect(botao("Excluir")).toBeNull();
  });

  it("cada acao aparece so quando o servidor a libera naquele alerta", async () => {
    listar.mockResolvedValue([alerta({ can_edit: true, can_delete: false })]);
    abrir();
    await screen.findByText(/1 destinatario\(s\)/);

    expect(botao("Pausar")).not.toBeNull();
    expect(botao("Editar")).not.toBeNull();
    expect(botao("Excluir")).toBeNull();
  });

  it("sem os campos novos (servidor antigo) vale so a permissao da colecao", async () => {
    listar.mockResolvedValue([alerta()]);
    abrir();
    await screen.findByText(/1 destinatario\(s\)/);

    expect(botao("Editar")).not.toBeNull();
    expect(botao("Excluir")).not.toBeNull();
  });

  it("mostra quem criou o alerta, com o nome formatado", async () => {
    listar.mockResolvedValue([alerta({ created_by_name: "JOAO PEDRO" })]);
    abrir();

    expect(await screen.findByText(/criado por Joao Pedro/)).toBeTruthy();
  });
});

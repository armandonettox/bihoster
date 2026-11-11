import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuditAnalytics from "./AuditAnalytics";

const mocks = vi.hoisted(() => ({ summary: vi.fn() }));
vi.mock("../../api/audit", () => ({ getAuditSummary: mocks.summary }));

const SUMMARY = {
  totals: { events: 1234, active_users: 8, logins_ok: 90, logins_blocked: 3, accounts_locked: 0 },
  by_day: [
    { date: "2026-11-08", count: 5 },
    { date: "2026-11-09", count: 0 },
    { date: "2026-11-10", count: 12 },
  ],
  by_hour: Array.from({ length: 24 }, (_, h) => (h === 9 ? 7 : 0)),
  by_action: [
    { action: "login", label: "Login", count: 90 },
    { action: "view_collection", label: "Colecao visitada", count: 40 },
  ],
  top_users: [{ user_id: 1, name: "Ana Lima", email: "ana@example.com", count: 30 }],
  top_collections: [{ workspace_id: 2, name: "Financeiro", visits: 25 }],
  top_reports: [
    { report_id: "11", name: "Vendas por regiao", collection: "Comercial", visits: 18 },
    { report_id: "12", name: "Custo assistencial", collection: null, visits: 1 },
  ],
  login_methods: { password: 60, google: 30 },
  timezone: "America/Sao_Paulo",
};

beforeEach(() => {
  mocks.summary.mockReset();
});

describe("AuditAnalytics", () => {
  it("mostra os cartoes, os rankings, as colecoes mais visitadas e a rosca de metodos", async () => {
    mocks.summary.mockResolvedValue(SUMMARY);
    render(<AuditAnalytics filters={{ date_from: "2026-11-01" }} />);

    expect(await screen.findByText("1.234")).toBeTruthy();
    expect(screen.getByText("Pessoas ativas")).toBeTruthy();
    expect(screen.getByText("Logins bloqueados")).toBeTruthy();
    expect(screen.getByText("Colecao visitada")).toBeTruthy(); // acao mais frequente
    expect(screen.getByText("Ana Lima")).toBeTruthy();
    expect(screen.getByText("Financeiro")).toBeTruthy();
    expect(screen.getByText("25 visitas")).toBeTruthy();
    expect(screen.getByText("Relatorios mais visitados")).toBeTruthy();
    expect(screen.getByText("Vendas por regiao")).toBeTruthy();
    expect(screen.getByText("18 aberturas")).toBeTruthy();
    expect(screen.getByText("1 abertura")).toBeTruthy();
    expect(screen.getByText("Vendas por regiao").closest("li")?.getAttribute("title")).toBe("Colecao: Comercial");
    expect(screen.getByText("Email e senha")).toBeTruthy();
    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByText("Horario de pico")).toBeTruthy();
    expect(mocks.summary).toHaveBeenCalledWith({ date_from: "2026-11-01" });
  });

  it("cartao de bloqueio so ganha destaque quando ha ocorrencia", async () => {
    mocks.summary.mockResolvedValue(SUMMARY);
    const { container } = render(<AuditAnalytics filters={{}} />);
    await screen.findByText("1.234");

    // 3 logins bloqueados: destacado; 0 contas travadas: normal
    expect(container.querySelectorAll(".audit-stat-danger")).toHaveLength(1);
  });

  it("busca de novo quando os filtros mudam", async () => {
    mocks.summary.mockResolvedValue(SUMMARY);
    const { rerender } = render(<AuditAnalytics filters={{}} />);
    await screen.findByText("1.234");

    rerender(<AuditAnalytics filters={{ user_id: [3, 4] }} />);

    await waitFor(() => expect(mocks.summary).toHaveBeenLastCalledWith({ user_id: [3, 4] }));
  });

  it("sem eventos mostra o aviso e nao quebra os graficos", async () => {
    mocks.summary.mockResolvedValue({
      ...SUMMARY,
      totals: { events: 0, active_users: 0, logins_ok: 0, logins_blocked: 0, accounts_locked: 0 },
      by_day: [{ date: "2026-11-10", count: 0 }],
      by_hour: Array(24).fill(0),
      by_action: [],
      top_users: [],
      top_collections: [],
      top_reports: [],
      login_methods: { password: 0, google: 0 },
    });
    render(<AuditAnalytics filters={{}} />);

    expect(await screen.findByText("Nenhum evento nesse periodo e com esses filtros.")).toBeTruthy();
    expect(screen.getByText("Nenhuma visita registrada.")).toBeTruthy();
    expect(screen.getByText("Nenhuma abertura registrada.")).toBeTruthy();
    expect(screen.getByText("Nenhum login no periodo.")).toBeTruthy();
  });

  it("erro ao carregar mostra mensagem", async () => {
    mocks.summary.mockRejectedValue(new Error("falhou"));
    render(<AuditAnalytics filters={{}} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { AuditFilters, AuditQueryResult, AuditSummary, DashboardWidget, WidgetQuery } from "../../../api/audit";
import type { FilterPatch } from "./interactions";
import WidgetView from "./WidgetView";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../../api/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/audit")>()),
  queryAudit: mocks.query,
}));

const SUMMARY: AuditSummary = {
  totals: { events: 100, active_users: 3, logins_ok: 40, logins_blocked: 2, accounts_locked: 1 },
  by_day: [
    { date: "2026-11-09", count: 3 },
    { date: "2026-11-10", count: 5 },
  ],
  by_hour: Array(24).fill(0),
  by_action: [
    { action: "login", label: "Login", count: 40 },
    { action: "view_report", label: "Relatorio aberto", count: 30 },
  ],
  top_users: [{ user_id: 7, name: "Ana Lima", email: "ana@example.com", count: 20 }],
  top_collections: [{ workspace_id: 2, name: "Financeiro", visits: 25 }],
  top_reports: [{ report_id: "11", name: "Vendas", collection: "Comercial", visits: 18 }],
  login_methods: { password: 30, google: 10 },
  timezone: "UTC",
};

function widget(type: DashboardWidget["type"], source: string, query: WidgetQuery | null = null): DashboardWidget {
  return { id: "w", type, source, title: null, color: null, query, x: 0, y: 0, w: 10, h: 7 };
}

function result(group_by: AuditQueryResult["group_by"], rows: AuditQueryResult["rows"]): AuditQueryResult {
  return { metric: "events", metric_label: "Eventos", group_by, rows, total: 10, timezone: "UTC" };
}

type FilterSpy = Mock<(patch: FilterPatch) => void>;

const show = (w: DashboardWidget, over: { filters?: AuditFilters; editing?: boolean; onFilterBy?: FilterSpy } = {}) => {
  const onFilterBy: FilterSpy | undefined = "onFilterBy" in over ? over.onFilterBy : vi.fn<(patch: FilterPatch) => void>();
  return {
    onFilterBy,
    ...render(<WidgetView widget={w} summary={SUMMARY} filters={over.filters ?? {}} editing={over.editing ?? false} onFilterBy={onFilterBy} />),
  };
};

beforeEach(() => {
  mocks.query.mockReset();
});

describe("WidgetView - clicar filtra a pagina", () => {
  it("barras de acao, pessoa, colecao e relatorio pedem o filtro certo", () => {
    const cases: [DashboardWidget, string, object][] = [
      [widget("bars", "by_action"), "Login", { actions: ["login"] }],
      [widget("bars", "top_users"), "Ana Lima", { userIds: ["7"] }],
      [widget("bars", "top_collections"), "Financeiro", { workspaceIds: ["2"] }],
      [widget("bars", "top_reports"), "Vendas", { reportIds: ["11"] }],
    ];
    for (const [w, name, patch] of cases) {
      const { onFilterBy, unmount } = show(w);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
      expect(onFilterBy).toHaveBeenCalledWith(patch);
      unmount();
    }
  });

  it("clicar num dia do grafico de linha pede aquele dia", () => {
    const { onFilterBy, container } = show(widget("line", "by_day"));

    fireEvent.click(container.querySelectorAll("rect.audit-line-hit")[1]);

    expect(onFilterBy).toHaveBeenCalledWith({ period: "custom", customFrom: "2026-11-10", customTo: "2026-11-10" });
  });

  it("os itens que ja estao filtrados ficam destacados", () => {
    const { container } = show(widget("bars", "by_action"), { filters: { action: ["login"] } });

    expect(container.querySelectorAll(".chart-selected")).toHaveLength(1);
    expect(container.querySelectorAll(".chart-dim")).toHaveLength(1);
  });

  it("visual personalizado por acao tambem filtra, e por hora nao (nao ha filtro de hora)", async () => {
    mocks.query.mockResolvedValue(result("action", [{ key: "login", label: "Login", value: 5 }]));
    const byAction = show(widget("bars", "custom", { metric: "events", group_by: "action", limit: 8 }));
    fireEvent.click(await screen.findByRole("button", { name: /Login/ }));
    expect(byAction.onFilterBy).toHaveBeenCalledWith({ actions: ["login"] });
    byAction.unmount();

    mocks.query.mockResolvedValue(result("hour", [{ key: "9", label: "9h", value: 5 }]));
    show(widget("bars", "custom", { metric: "events", group_by: "hour", limit: 8 }));
    await screen.findByText("9h");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("linha da tabela personalizada filtra e a selecionada fica marcada", async () => {
    mocks.query.mockResolvedValue(
      result("user", [
        { key: "7", label: "Ana Lima", value: 20 },
        { key: "8", label: "Bruno Sa", value: 10 },
      ]),
    );
    const { onFilterBy, container } = show(widget("table", "custom", { metric: "events", group_by: "user", limit: 8 }), {
      filters: { user_id: [8] },
    });

    fireEvent.click(await screen.findByText("Ana Lima"));

    expect(onFilterBy).toHaveBeenCalledWith({ userIds: ["7"] });
    expect(container.querySelector("tr.chart-selected")?.textContent).toContain("Bruno Sa");
  });

  it("rosca por recurso filtra pelo recurso", async () => {
    mocks.query.mockResolvedValue(result("entity", [{ key: "report", label: "Relatorio", value: 8 }, { key: "user", label: "Usuario", value: 2 }]));
    const { onFilterBy } = show(widget("donut", "custom", { metric: "events", group_by: "entity", limit: 8 }));

    fireEvent.click(await screen.findByRole("button", { name: /Relatorio/ }));

    expect(onFilterBy).toHaveBeenCalledWith({ entities: ["report"] });
  });

  it("rosca de metodo de login so mostra o rotulo (sem filtro correspondente)", () => {
    show(widget("donut", "login_methods"));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("no modo de edicao o clique nao filtra: so os botoes de configurar e remover existem", () => {
    const { onFilterBy } = show(widget("bars", "by_action"), { editing: true });

    expect(screen.queryByRole("button", { name: /^Login/ })).toBeNull();
    expect(onFilterBy).not.toHaveBeenCalled();
  });

  it("sem onFilterBy (ex: pre-visualizacao do editor) o visual so mostra o rotulo", () => {
    show(widget("bars", "by_action"), { onFilterBy: undefined });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("WidgetView - cartoes clicaveis", () => {
  it("cartao que conta uma acao e um botao que filtra por ela", () => {
    const { onFilterBy } = show(widget("stat", "logins_blocked"));

    fireEvent.click(screen.getByRole("button", { name: /Logins bloqueados/ }));

    expect(onFilterBy).toHaveBeenCalledWith({ actions: ["login_blocked"] });
  });

  it("funciona pelo teclado (Enter e espaco)", () => {
    const { onFilterBy } = show(widget("stat", "logins_ok"));
    const card = screen.getByRole("button", { name: /Logins/ });

    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    fireEvent.keyDown(card, { key: "a" });

    expect(onFilterBy).toHaveBeenCalledTimes(2);
  });

  it("cartao geral (eventos, pessoas) nao e clicavel", () => {
    show(widget("stat", "events"));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("o cartao fica destacado quando a pagina esta filtrada por aquela acao", () => {
    const { container } = show(widget("stat", "logins_ok"), { filters: { action: ["login"] } });
    expect(container.querySelector(".audit-stat.chart-selected")).not.toBeNull();
  });

  it("cartao personalizado usa a medida: relatorios abertos filtra por 'Relatorio aberto'", async () => {
    mocks.query.mockResolvedValue({ ...result("none", [{ key: "total", label: "Relatorios abertos", value: 3 }]), total: 3 });
    const { onFilterBy } = show(widget("stat", "custom", { metric: "report_opens", group_by: "none", limit: 8 }));
    await waitFor(() => expect(screen.getByRole("button")).toBeTruthy());

    fireEvent.click(screen.getByRole("button"));

    expect(onFilterBy).toHaveBeenCalledWith({ actions: ["view_report"] });
  });

  it("no modo de edicao o cartao nao e botao de filtro", () => {
    show(widget("stat", "logins_ok"), { editing: true });
    expect(screen.queryByRole("button", { name: /^Logins$/ })).toBeNull();
  });
});

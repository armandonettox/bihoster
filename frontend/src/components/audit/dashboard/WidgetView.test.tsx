import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AuditSummary, DashboardWidget } from "../../../api/audit";
import WidgetView from "./WidgetView";
import { widgetTitle } from "./widgetMeta";

const SUMMARY: AuditSummary = {
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

function widget(over: Partial<DashboardWidget>): DashboardWidget {
  return { id: "w", type: "stat", source: "events", title: null, color: null, query: null, x: 0, y: 0, w: 4, h: 2, ...over };
}

const show = (w: DashboardWidget, summary = SUMMARY, editing = false) =>
  render(<WidgetView widget={w} summary={summary} editing={editing} />);

describe("WidgetView - cartoes", () => {
  it("mostra o valor formatado e o nome do cartao", () => {
    show(widget({ source: "events" }));
    expect(screen.getByText("1.234")).toBeTruthy();
    expect(screen.getByText("Eventos")).toBeTruthy();
  });

  it("titulo proprio troca o nome padrao", () => {
    show(widget({ source: "active_users", title: "Gente ativa" }));
    expect(screen.getByText("Gente ativa")).toBeTruthy();
    expect(screen.queryByText("Pessoas ativas")).toBeNull();
  });

  it("cartao de risco so ganha destaque quando ha ocorrencia", () => {
    const { container, unmount } = show(widget({ source: "logins_blocked" }));
    expect(container.querySelector(".audit-stat-danger")).not.toBeNull();
    unmount();
    const zero = show(widget({ source: "accounts_locked" }));
    expect(zero.container.querySelector(".audit-stat-danger")).toBeNull();
  });
});

describe("WidgetView - graficos e listas", () => {
  it("mostra cada fonte com o titulo padrao e os dados", () => {
    const cases: [DashboardWidget, string, string][] = [
      [widget({ type: "line", source: "by_day" }), "Eventos por dia", "10/11"],
      [widget({ type: "bars", source: "by_action" }), "Acoes mais frequentes", "Colecao visitada"],
      [widget({ type: "bars", source: "top_users" }), "Pessoas mais ativas", "Ana Lima"],
      [widget({ type: "bars", source: "top_collections" }), "Colecoes mais visitadas", "25 visitas"],
      [widget({ type: "bars", source: "top_reports" }), "Relatorios mais visitados", "18 aberturas"],
      [widget({ type: "donut", source: "login_methods" }), "Logins por metodo", "Email e senha"],
      [widget({ type: "hours", source: "by_hour" }), "Horario de pico", "12h"],
    ];
    for (const [w, title, content] of cases) {
      const { container, unmount } = show(w);
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
      expect(container.textContent).toContain(content);
      unmount();
    }
  });

  it("o titulo proprio do visual vale no lugar do padrao", () => {
    show(widget({ type: "bars", source: "top_users", title: "Quem mais usa" }));
    expect(screen.getByRole("heading", { name: "Quem mais usa" })).toBeTruthy();
    expect(widgetTitle(widget({ type: "line", source: "by_day", title: null }))).toBe("Eventos por dia");
  });

  it("dicas: horario de pico traz o fuso e relatorios explica a contagem", () => {
    const hours = show(widget({ type: "hours", source: "by_hour" }));
    expect(hours.container.textContent).toContain("America/Sao_Paulo");
    hours.unmount();
    const reports = show(widget({ type: "bars", source: "top_reports" }));
    expect(reports.container.textContent).toContain("a cada 10 minutos");
  });

  it("sem dados mostra mensagem em vez de grafico vazio", () => {
    const empty: AuditSummary = {
      ...SUMMARY,
      by_action: [],
      top_users: [],
      top_collections: [],
      top_reports: [],
      login_methods: { password: 0, google: 0 },
    };
    for (const [w, message] of [
      [widget({ type: "bars", source: "by_action" }), "Sem dados."],
      [widget({ type: "bars", source: "top_users" }), "Sem dados."],
      [widget({ type: "bars", source: "top_collections" }), "Nenhuma visita registrada."],
      [widget({ type: "bars", source: "top_reports" }), "Nenhuma abertura registrada."],
      [widget({ type: "donut", source: "login_methods" }), "Nenhum login no periodo."],
    ] as [DashboardWidget, string][]) {
      const { unmount } = show(w, empty);
      expect(screen.getByText(message)).toBeTruthy();
      unmount();
    }
  });

  it("fonte que esta versao nao conhece nao quebra o painel", () => {
    show(widget({ type: "bars", source: "algo_novo" }));
    expect(screen.getByText("Este visual nao e conhecido nesta versao.")).toBeTruthy();
  });
});

describe("WidgetView - modo de edicao", () => {
  it("o cabecalho do grafico vira a alca de arrastar, com o icone, so na edicao", () => {
    const edit = show(widget({ type: "line", source: "by_day" }), SUMMARY, true);
    expect(edit.container.querySelector(".dash-header.dash-drag")).not.toBeNull();
    expect(edit.container.querySelector(".dash-grip")).not.toBeNull();
    edit.unmount();

    const view = show(widget({ type: "line", source: "by_day" }), SUMMARY, false);
    expect(view.container.querySelector(".dash-drag")).toBeNull();
    expect(view.container.querySelector(".dash-grip")).toBeNull();
  });

  it("o cartao inteiro e a alca de arrastar na edicao", () => {
    const { container } = show(widget({ source: "events" }), SUMMARY, true);
    expect(container.querySelector(".audit-stat.dash-drag")).not.toBeNull();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditQueryResult, DashboardWidget, WidgetQuery } from "../../../api/audit";
import WidgetView from "./WidgetView";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../../api/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/audit")>()),
  queryAudit: mocks.query,
}));

function result(over: Partial<AuditQueryResult> = {}): AuditQueryResult {
  return {
    metric: "events",
    metric_label: "Eventos",
    group_by: "action",
    rows: [
      { key: "login", label: "Login", value: 90 },
      { key: "view_report", label: "Relatorio aberto", value: 40 },
    ],
    total: 130,
    timezone: "America/Sao_Paulo",
    ...over,
  };
}

function custom(type: DashboardWidget["type"], query: Partial<WidgetQuery> = {}, over: Partial<DashboardWidget> = {}): DashboardWidget {
  return {
    id: "c",
    type,
    source: "custom",
    title: null,
    color: null,
    query: { metric: "events", group_by: "action", limit: 8, ...query },
    x: 0,
    y: 0,
    w: 10,
    h: 7,
    ...over,
  };
}

const show = (widget: DashboardWidget, filters = {}, editing = false, extra = {}) =>
  render(<WidgetView widget={widget} summary={null} filters={filters} editing={editing} {...extra} />);

beforeEach(() => {
  mocks.query.mockReset().mockResolvedValue(result());
});

describe("WidgetView - visual personalizado", () => {
  it("busca com a consulta do visual e os filtros da pagina", async () => {
    show(custom("bars", { metric: "report_opens", group_by: "report", limit: 5 }), { date_from: "2026-11-01", user_id: [3] });

    await screen.findByText("Login");

    expect(mocks.query).toHaveBeenCalledWith(
      { date_from: "2026-11-01", user_id: [3] },
      { metric: "report_opens", group_by: "report", limit: 5 },
    );
  });

  it("busca de novo quando os filtros mudam, mas nao quando so a posicao muda", async () => {
    const widget = custom("bars");
    const { rerender } = show(widget, { date_from: "2026-11-01" });
    await screen.findByText("Login");
    expect(mocks.query).toHaveBeenCalledTimes(1);

    rerender(<WidgetView widget={{ ...widget, x: 5, y: 3 }} summary={null} filters={{ date_from: "2026-11-01" }} editing={false} />);
    expect(mocks.query).toHaveBeenCalledTimes(1);

    rerender(<WidgetView widget={widget} summary={null} filters={{ date_from: "2026-10-01" }} editing={false} />);
    await waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2));
  });

  it("titulo: o escolhido, ou 'medida por agrupamento' quando nao ha", async () => {
    const first = show(custom("bars", { metric: "report_opens", group_by: "report" }));
    expect(screen.getByRole("heading", { name: "Relatorios abertos por relatorio" })).toBeTruthy();
    await screen.findByText("Login");
    first.unmount();

    show(custom("bars", {}, { title: "Meu grafico" }));
    expect(screen.getByRole("heading", { name: "Meu grafico" })).toBeTruthy();
  });

  it("cartao mostra o total da medida, com o titulo como legenda", async () => {
    mocks.query.mockResolvedValue(result({ group_by: "none", rows: [{ key: "total", label: "Logins", value: 151 }], total: 151 }));
    const { container } = show(custom("stat", { metric: "logins", group_by: "none" }, { title: null }));

    expect(container.querySelector(".audit-stat-value")?.textContent).toBe("...");
    await waitFor(() => expect(container.querySelector(".audit-stat-value")?.textContent).toBe("151"));
    expect(screen.getByText("Logins")).toBeTruthy();
  });

  it("barras listam cada linha com o valor", async () => {
    show(custom("bars"));
    expect(await screen.findByText("Relatorio aberto")).toBeTruthy();
    expect(screen.getByText("90")).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
  });

  it("linha por dia mostra datas curtas e por hora mostra o proprio rotulo", async () => {
    mocks.query.mockResolvedValue(
      result({
        group_by: "day",
        rows: [
          { key: "2026-11-09", label: "2026-11-09", value: 3 },
          { key: "2026-11-10", label: "2026-11-10", value: 5 },
        ],
      }),
    );
    const day = show(custom("line", { group_by: "day" }));
    await waitFor(() => expect(day.container.textContent).toContain("09/11"));
    expect(day.container.textContent).toContain("10/11");
    day.unmount();

    mocks.query.mockResolvedValue(
      result({
        group_by: "hour",
        rows: [
          { key: "0", label: "0h", value: 1 },
          { key: "9", label: "9h", value: 4 },
        ],
      }),
    );
    const hour = show(custom("line", { group_by: "hour" }));
    await waitFor(() => expect(hour.container.textContent).toContain("9h"));
  });

  it("rosca mostra a legenda de cada fatia", async () => {
    show(custom("donut"));
    expect(await screen.findByText("Login")).toBeTruthy();
    expect(screen.getByText("Relatorio aberto")).toBeTruthy();
  });

  it("tabela tem cabecalho com a medida e uma linha por item", async () => {
    mocks.query.mockResolvedValue(result({ group_by: "user", rows: [{ key: "1", label: "Ana Lima", value: 30 }] }));
    show(custom("table", { group_by: "user" }));

    expect(await screen.findByText("Ana Lima")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Eventos" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Item" })).toBeTruthy();
    expect(screen.getByText("30")).toBeTruthy();
  });

  it("sem dados mostra mensagem; com falha mostra aviso e o cartao mostra traco", async () => {
    mocks.query.mockResolvedValue(result({ rows: [{ key: "login", label: "Login", value: 0 }], total: 0 }));
    const empty = show(custom("bars"));
    expect(await screen.findByText("Sem dados.")).toBeTruthy();
    empty.unmount();

    mocks.query.mockRejectedValue(new Error("falhou"));
    const failed = show(custom("bars"));
    expect((await screen.findByRole("alert")).textContent).toContain("Nao foi possivel carregar");
    failed.unmount();

    const stat = show(custom("stat", { group_by: "none" }));
    await waitFor(() => expect(stat.container.querySelector(".audit-stat-value")?.textContent).toBe("--"));
  });

  it("a cor escolhida vira uma classe no visual; sem cor nao ha classe", async () => {
    const colored = show(custom("bars", {}, { color: "accent" }));
    await screen.findByText("Login");
    expect(colored.container.querySelector(".dash-color-accent")).not.toBeNull();
    colored.unmount();

    const plain = show(custom("bars"));
    await screen.findByText("Login");
    expect(plain.container.querySelector("[class*='dash-color-']")).toBeNull();
  });
});

describe("WidgetView - botoes de edicao", () => {
  it("na edicao ha Configurar e Remover, que chamam os callbacks, e fora dela nao ha", async () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    const editing = show(custom("bars", {}, { title: "Meu grafico" }), {}, true, { onEdit, onRemove });
    await screen.findByText("Login");

    fireEvent.click(screen.getByRole("button", { name: "Configurar Meu grafico" }));
    fireEvent.click(screen.getByRole("button", { name: "Remover Meu grafico" }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
    editing.unmount();

    show(custom("bars", {}, { title: "Meu grafico" }));
    await screen.findByText("Login");
    expect(screen.queryByRole("button", { name: /Configurar/ })).toBeNull();
  });

  it("o cartao tambem tem os botoes na edicao, e eles ficam fora da area de arrastar", async () => {
    mocks.query.mockResolvedValue(result({ group_by: "none", rows: [{ key: "total", label: "x", value: 1 }], total: 1 }));
    const { container } = show(custom("stat", { group_by: "none" }), {}, true, { onEdit: vi.fn(), onRemove: vi.fn() });
    await screen.findByText("1");

    expect(screen.getByRole("button", { name: /Configurar/ })).toBeTruthy();
    expect(container.querySelector(".dash-drag .dash-actions")).not.toBeNull(); // a grade ignora o arraste que comeca nos botoes (cancel)
  });
});

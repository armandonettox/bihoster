import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditOptions, AuditQueryResult, DashboardWidget } from "../../../api/audit";
import WidgetEditor from "./WidgetEditor";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../../api/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/audit")>()),
  queryAudit: mocks.query,
}));

const RESULT: AuditQueryResult = {
  metric: "events",
  metric_label: "Eventos",
  group_by: "action",
  rows: [{ key: "login", label: "Login", value: 5 }],
  total: 5,
  timezone: "UTC",
};

const onSave = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  mocks.query.mockReset().mockResolvedValue(RESULT);
  onSave.mockReset();
  onClose.mockReset();
});

const OPTIONS: AuditOptions = {
  actions: [
    { action: "login", label: "Login" },
    { action: "view_report", label: "Relatorio aberto" },
  ],
  entities: [{ entity: "report", label: "Relatorio" }],
  users: [{ id: 3, name: "Ana", email: "ana@example.com" } as AuditOptions["users"][number]],
  collections: [{ id: 7, name: "Financeiro" }],
  reports: [{ id: 9, name: "Vendas", collection: "Financeiro" }],
};

const open = (initial?: DashboardWidget, filters = {}, options: AuditOptions | null = OPTIONS) =>
  render(
    <WidgetEditor initial={initial} filters={filters} options={options} summary={null} onSave={onSave} onClose={onClose} />,
  );

const select = (name: string) => screen.getByLabelText(name) as HTMLSelectElement;
const options = (name: string) => Array.from(select(name).options).map((o) => o.textContent);

describe("WidgetEditor - visual novo", () => {
  it("abre com barras de eventos por acao e mostra a pre-visualizacao com os filtros da pagina", async () => {
    open(undefined, { date_from: "2026-11-01" });

    expect(screen.getByText("Novo visual")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Barras/ }).getAttribute("aria-checked")).toBe("true");
    expect(select("O que medir").value).toBe("events");
    expect(select("Agrupar por").value).toBe("action");
    expect(await screen.findByText("Login")).toBeTruthy();
    expect(mocks.query).toHaveBeenCalledWith({ date_from: "2026-11-01" }, {
      metric: "events",
      group_by: "action",
      limit: 8,
      filters: null,
    });
  });

  it("lista os cinco tipos e as oito medidas", () => {
    open();
    expect(screen.getAllByRole("radio", { name: /Cartao|Linha|Barras|Rosca|Tabela/ })).toHaveLength(5);
    expect(options("O que medir")).toHaveLength(8);
  });

  it("cartao so tem total: o agrupamento fica fixo e desabilitado", () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: /Cartao/ }));

    expect(select("Agrupar por").value).toBe("none");
    expect(select("Agrupar por").disabled).toBe(true);
    expect(screen.queryByLabelText("Quantos itens")).toBeNull();
  });

  it("linha so aceita dia, hora e dia da semana, e trocar de tipo corrige um agrupamento que deixou de servir", () => {
    open();
    expect(select("Agrupar por").value).toBe("action");

    fireEvent.click(screen.getByRole("radio", { name: /Linha/ }));

    expect(options("Agrupar por")).toEqual(["Dia", "Hora do dia", "Dia da semana"]);
    expect(select("Agrupar por").value).toBe("day");
  });

  it("rosca nao oferece dia nem hora", () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: /Rosca/ }));
    expect(options("Agrupar por")).not.toContain("Dia");
    expect(options("Agrupar por")).not.toContain("Hora do dia");
    expect(options("Agrupar por")).toContain("Acao");
  });

  it("metodo de login so aparece para a medida Logins, e trocar a medida corrige o agrupamento", () => {
    open();
    expect(options("Agrupar por")).not.toContain("Metodo de login");

    fireEvent.change(select("O que medir"), { target: { value: "logins" } });
    fireEvent.change(select("Agrupar por"), { target: { value: "login_method" } });
    expect(select("Agrupar por").value).toBe("login_method");

    fireEvent.change(select("O que medir"), { target: { value: "events" } });
    expect(options("Agrupar por")).not.toContain("Metodo de login");
    expect(select("Agrupar por").value).not.toBe("login_method");
  });

  it("quantos itens so aparece nos agrupamentos por categoria", () => {
    open();
    expect(screen.getByLabelText("Quantos itens")).toBeTruthy(); // barras por acao

    fireEvent.change(select("Agrupar por"), { target: { value: "day" } });
    expect(screen.queryByLabelText("Quantos itens")).toBeNull();
  });

  it("cor so para cartao, linha e barras; rosca e tabela escondem", () => {
    open();
    expect(screen.getByRole("radiogroup", { name: "Cor" })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /Rosca/ }));
    expect(screen.queryByRole("radiogroup", { name: "Cor" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Tabela/ }));
    expect(screen.queryByRole("radiogroup", { name: "Cor" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Linha/ }));
    expect(screen.getByRole("radiogroup", { name: "Cor" })).toBeTruthy();
  });

  it("Adicionar visual entrega o visual com id valido, fonte personalizada e a consulta escolhida", () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: /Tabela/ }));
    fireEvent.change(select("O que medir"), { target: { value: "report_opens" } });
    fireEvent.change(select("Agrupar por"), { target: { value: "report" } });
    fireEvent.change(select("Quantos itens"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Titulo"), { target: { value: "  Mais abertos  " } });

    fireEvent.click(screen.getByRole("button", { name: "Adicionar visual" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as DashboardWidget;
    expect(saved).toMatchObject({
      type: "table",
      source: "custom",
      title: "Mais abertos",
      color: null, // tabela nao usa cor
      query: { metric: "report_opens", group_by: "report", limit: 15 },
    });
    expect(saved.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(saved.id).not.toBe("preview");
  });

  it("cor escolhida vai no visual; trocar para um tipo sem cor descarta a cor", () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: "Vermelho" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar visual" }));
    expect(onSave.mock.calls[0][0].color).toBe("danger");

    onSave.mockReset();
    fireEvent.click(screen.getByRole("radio", { name: /Rosca/ }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar visual" }));
    expect(onSave.mock.calls[0][0].color).toBeNull();
  });

  it("titulo em branco fica sem titulo e o campo sugere o titulo padrao", () => {
    open();
    expect((screen.getByLabelText("Titulo") as HTMLInputElement).placeholder).toBe("Eventos por acao");
    fireEvent.change(select("O que medir"), { target: { value: "people" } });
    expect((screen.getByLabelText("Titulo") as HTMLInputElement).placeholder).toBe("Pessoas ativas por acao");

    fireEvent.click(screen.getByRole("button", { name: "Adicionar visual" }));
    expect(onSave.mock.calls[0][0].title).toBeNull();
  });

  it("Cancelar fecha sem salvar", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("WidgetEditor - configurar um visual existente", () => {
  const CUSTOM: DashboardWidget = {
    id: "abc",
    type: "line",
    source: "custom",
    title: "Minha linha",
    color: "accent",
    query: { metric: "logins", group_by: "hour", limit: 8 },
    x: 4,
    y: 9,
    w: 12,
    h: 5,
  };

  it("abre com os valores do visual e Aplicar mantem id, posicao e tamanho", () => {
    open(CUSTOM);

    expect(screen.getByText("Configurar visual")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Linha/ }).getAttribute("aria-checked")).toBe("true");
    expect(select("O que medir").value).toBe("logins");
    expect(select("Agrupar por").value).toBe("hour");
    expect((screen.getByLabelText("Titulo") as HTMLInputElement).value).toBe("Minha linha");
    expect(screen.getByRole("radio", { name: "Verde" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.change(select("Agrupar por"), { target: { value: "weekday" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(onSave.mock.calls[0][0]).toMatchObject({
      id: "abc",
      x: 4,
      y: 9,
      w: 12,
      h: 5,
      query: { metric: "logins", group_by: "weekday" },
    });
  });

  const BUILT_IN: DashboardWidget = {
    id: "stat-events",
    type: "stat",
    source: "events",
    title: null,
    color: null,
    query: null,
    x: 0,
    y: 0,
    w: 4,
    h: 2,
  };

  it("visual padrao so aceita titulo e cor, sem escolher medida ou agrupamento e sem pre-visualizacao", () => {
    open(BUILT_IN);

    expect(screen.getByText(/visual padrao/)).toBeTruthy();
    expect(screen.queryByLabelText("O que medir")).toBeNull();
    expect(screen.queryByLabelText("Agrupar por")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Tipo de visual" })).toBeNull();
    expect(screen.queryByLabelText("Pre-visualizacao")).toBeNull();

    fireEvent.change(screen.getByLabelText("Titulo"), { target: { value: "Total geral" } });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Cor" })).getByRole("radio", { name: "Azul" }));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(onSave.mock.calls[0][0]).toEqual({ ...BUILT_IN, title: "Total geral", color: "secondary" });
    expect(mocks.query).not.toHaveBeenCalled(); // visual padrao nao consulta
  });

  it("visual padrao do tipo rosca nao mostra cor", () => {
    open({ ...BUILT_IN, id: "donut-logins", type: "donut", source: "login_methods" });
    expect(screen.queryByRole("radiogroup", { name: "Cor" })).toBeNull();
  });
});


describe("WidgetEditor - filtros do visual", () => {
  const pick = (label: RegExp, option: string) => {
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(screen.getByLabelText(new RegExp(option)));
  };

  it("visual novo mostra os cinco filtros, todos sem valor, e o visual padrao nao mostra", () => {
    open();
    expect(screen.getByText("Filtros deste visual")).toBeTruthy();
    for (const nome of ["Pessoa", "Acao", "Recurso", "Colecao", "Relatorio"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${nome}: `) })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: /^Acao: Todas/ })).toBeTruthy();
  });

  it("visual padrao nao tem filtros proprios", () => {
    open({
      id: "stat-events", type: "stat", source: "events", title: null, color: null, query: null, x: 0, y: 0, w: 4, h: 2,
    });
    expect(screen.queryByText("Filtros deste visual")).toBeNull();
  });

  it("os valores escolhidos vao na consulta do visual salvo e na pre-visualizacao", async () => {
    open();
    pick(/^Acao: /, "Login");
    pick(/^Colecao: /, "Financeiro");
    pick(/^Pessoa: /, "Ana");

    fireEvent.click(screen.getByRole("button", { name: "Adicionar visual" }));

    expect(onSave.mock.calls[0][0].query.filters).toEqual({
      user_id: [3],
      action: ["login"],
      workspace_id: [7],
      report_id: [],
      entity: [],
    });
  });

  it("sem nada marcado o visual salvo leva filtros null", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar visual" }));
    expect(onSave.mock.calls[0][0].query.filters).toBeNull();
  });

  it("ao configurar um visual existente, os filtros dele ja vem marcados", () => {
    open({
      id: "c1", type: "stat", source: "custom", title: null, color: null,
      query: { metric: "logins", group_by: "none", limit: 8, filters: { action: ["login"], workspace_id: [7] } },
      x: 0, y: 0, w: 4, h: 2,
    });
    expect(screen.getByRole("button", { name: "Acao: Login" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Colecao: Financeiro" })).toBeTruthy();
  });

  it("a pre-visualizacao consulta com os filtros da pagina e os do visual juntos", async () => {
    open(undefined, { date_from: "2026-11-01", action: ["login", "view_report"] });
    pick(/^Acao: /, "Login");

    await screen.findAllByText("Login");
    expect(mocks.query).toHaveBeenLastCalledWith(
      { date_from: "2026-11-01", action: ["login"] },
      expect.objectContaining({ filters: expect.objectContaining({ action: ["login"] }) }),
    );
  });
});

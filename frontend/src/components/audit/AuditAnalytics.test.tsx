import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dashboard, DashboardWidget } from "../../api/audit";
import AuditAnalytics from "./AuditAnalytics";

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  getDashboard: vi.fn(),
  save: vi.fn(),
  reset: vi.fn(),
  query: vi.fn(),
  toast: vi.fn(),
  grid: null as null | { widgets: DashboardWidget[]; editing: boolean; onChange: (w: DashboardWidget[]) => void },
}));

vi.mock("../../api/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/audit")>()),
  getAuditSummary: mocks.summary,
  getDashboard: mocks.getDashboard,
  saveDashboard: mocks.save,
  resetDashboard: mocks.reset,
  queryAudit: mocks.query,
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.toast }) }));
// A grade tem teste proprio; aqui ela e trocada por uma peca que mostra o que recebeu e deixa mover um visual
vi.mock("./dashboard/DashboardGrid", () => ({
  default: (props: {
    widgets: DashboardWidget[];
    editing: boolean;
    onChange: (w: DashboardWidget[]) => void;
    onEditWidget?: (id: string) => void;
    onRemoveWidget?: (id: string) => void;
  }) => {
    mocks.grid = props;
    return (
      <div data-testid="grid" data-editing={String(props.editing)}>
        {props.widgets.map((w) => (
          <span key={w.id}>{`${w.id}@${w.x},${w.y}`}</span>
        ))}
        <button onClick={() => props.onChange(props.widgets.map((w) => ({ ...w, x: w.x + 1 })))}>mover tudo</button>
        {props.widgets.map((w) => (
          <span key={`acoes-${w.id}`}>
            <button onClick={() => props.onEditWidget?.(w.id)}>{`configurar ${w.id}`}</button>
            <button onClick={() => props.onRemoveWidget?.(w.id)}>{`remover ${w.id}`}</button>
          </span>
        ))}
      </div>
    );
  },
}));

const WIDGETS: DashboardWidget[] = [
  { id: "a", type: "stat", source: "events", title: null, color: null, query: null, x: 0, y: 0, w: 4, h: 2 },
  { id: "b", type: "line", source: "by_day", title: null, color: null, query: null, x: 0, y: 2, w: 20, h: 6 },
];

const SUMMARY = {
  totals: { events: 10, active_users: 2, logins_ok: 4, logins_blocked: 0, accounts_locked: 0 },
  by_day: [],
  by_hour: Array(24).fill(0),
  by_action: [],
  top_users: [],
  top_collections: [],
  top_reports: [],
  login_methods: { password: 0, google: 0 },
  timezone: "UTC",
};

function dashboard(over: Partial<Dashboard> = {}): Dashboard {
  return { widgets: WIDGETS, columns: 20, is_default: true, updated_at: null, updated_by: null, ...over };
}

beforeEach(() => {
  mocks.summary.mockReset().mockResolvedValue(SUMMARY);
  mocks.getDashboard.mockReset().mockResolvedValue(dashboard());
  mocks.save.mockReset();
  mocks.reset.mockReset();
  mocks.query.mockReset().mockResolvedValue({
    metric: "events",
    metric_label: "Eventos",
    group_by: "action",
    rows: [{ key: "login", label: "Login", value: 5 }],
    total: 5,
    timezone: "UTC",
  });
  mocks.toast.mockReset();
  mocks.grid = null;
});

const open = (canEdit = true, filters = {}) => render(<AuditAnalytics filters={filters} canCreate={canEdit} canEdit={canEdit} canDelete={canEdit} />);

describe("AuditAnalytics - carregamento", () => {
  it("busca o resumo com os filtros e o painel salvo, e entrega os visuais a grade", async () => {
    open(true, { date_from: "2026-11-01" });

    expect(await screen.findByTestId("grid")).toBeTruthy();
    expect(mocks.summary).toHaveBeenCalledWith({ date_from: "2026-11-01" });
    expect(screen.getByText("a@0,0")).toBeTruthy();
    expect(screen.getByText("b@0,2")).toBeTruthy();
  });

  it("busca o resumo de novo quando os filtros mudam, mas o painel e carregado uma vez so", async () => {
    const { rerender } = open();
    await screen.findByTestId("grid");

    rerender(<AuditAnalytics filters={{ user_id: [3, 4] }} canCreate canEdit canDelete />);

    await waitFor(() => expect(mocks.summary).toHaveBeenLastCalledWith({ user_id: [3, 4] }));
    expect(mocks.getDashboard).toHaveBeenCalledTimes(1);
  });

  it("sem eventos mostra o aviso e o painel continua la", async () => {
    mocks.summary.mockResolvedValue({ ...SUMMARY, totals: { ...SUMMARY.totals, events: 0 } });
    open();

    expect(await screen.findByText("Nenhum evento nesse periodo e com esses filtros.")).toBeTruthy();
    expect(screen.getByTestId("grid")).toBeTruthy();
  });

  it("erro ao carregar o resumo ou o painel mostra mensagem", async () => {
    mocks.summary.mockRejectedValue(new Error("falhou"));
    const first = open();
    expect((await screen.findByRole("alert")).textContent).toContain("analiticos");
    first.unmount();

    mocks.summary.mockResolvedValue(SUMMARY);
    mocks.getDashboard.mockRejectedValue(new Error("falhou"));
    open();
    expect((await screen.findByRole("alert")).textContent).toContain("painel");
  });

  it("mostra quem salvou o layout, quando ha um layout salvo", async () => {
    mocks.getDashboard.mockResolvedValue(dashboard({ is_default: false, updated_by: "admin@example.com" }));
    open();
    expect(await screen.findByText("Layout salvo por admin@example.com.")).toBeTruthy();
  });
});

describe("AuditAnalytics - edicao do painel", () => {
  it("so quem pode editar ve o botao Editar painel", async () => {
    const view = open(false);
    await screen.findByTestId("grid");
    expect(screen.queryByRole("button", { name: /Editar painel/ })).toBeNull();
    view.unmount();

    open(true);
    expect(await screen.findByRole("button", { name: /Editar painel/ })).toBeTruthy();
  });

  it("Editar painel liga o modo de edicao e mostra Salvar, Cancelar e Restaurar padrao", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Editar painel/ }));

    expect(screen.getByTestId("grid").getAttribute("data-editing")).toBe("true");
    expect(screen.getByText(/Modo de edicao/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Restaurar padrao/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Editar painel/ })).toBeNull();
  });

  it("Salvar so habilita depois de mudar algo; salva o layout novo, avisa e sai da edicao", async () => {
    mocks.save.mockImplementation(async (widgets: DashboardWidget[]) => dashboard({ widgets, is_default: false, updated_by: "eu@x.com" }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Editar painel/ }));
    const save = screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "mover tudo" }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Painel salvo para todos."));
    expect(mocks.save.mock.calls[0][0].map((w: DashboardWidget) => [w.id, w.x])).toEqual([["a", 1], ["b", 1]]);
    expect(screen.getByTestId("grid").getAttribute("data-editing")).toBe("false");
    expect(screen.getByText("a@1,0")).toBeTruthy(); // mostra o que foi salvo
  });

  it("erro ao salvar avisa, mantem a edicao e o que foi movido", async () => {
    mocks.save.mockRejectedValue({ response: { data: { detail: "Painel invalido" } } });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Editar painel/ }));
    fireEvent.click(screen.getByRole("button", { name: "mover tudo" }));

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Painel invalido", "error"));
    expect(screen.getByTestId("grid").getAttribute("data-editing")).toBe("true");
    expect(screen.getByText("a@1,0")).toBeTruthy();
  });

  it("Cancelar sem mudar nada sai direto; com mudancas pede confirmacao e descarta", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Editar painel/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByTestId("grid").getAttribute("data-editing")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /Editar painel/ }));
    fireEvent.click(screen.getByRole("button", { name: "mover tudo" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Descartar as mudancas?")).toBeTruthy();
    expect(screen.getByTestId("grid").getAttribute("data-editing")).toBe("true"); // ainda editando

    fireEvent.click(dialog.getByRole("button", { name: "Descartar" }));

    expect(screen.getByTestId("grid").getAttribute("data-editing")).toBe("false");
    expect(screen.getByText("a@0,0")).toBeTruthy(); // voltou ao salvo
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("Restaurar padrao fica desligado enquanto vale o padrao e, com layout salvo, pede confirmacao", async () => {
    mocks.getDashboard.mockResolvedValue(dashboard({ is_default: true }));
    const padrao = open();
    fireEvent.click(await screen.findByRole("button", { name: /Editar painel/ }));
    expect((screen.getByRole("button", { name: /Restaurar padrao/ }) as HTMLButtonElement).disabled).toBe(true);
    padrao.unmount();

    mocks.getDashboard.mockResolvedValue(dashboard({ is_default: false, updated_by: "a@b.c" }));
    mocks.reset.mockResolvedValue(dashboard({ is_default: true }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Editar painel/ }));
    fireEvent.click(screen.getByRole("button", { name: /Restaurar padrao/ }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/apagado para todos/)).toBeTruthy();
    expect(mocks.reset).not.toHaveBeenCalled();

    fireEvent.click(dialog.getByRole("button", { name: "Restaurar" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Painel restaurado ao padrao."));
    expect(mocks.reset).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("grid").getAttribute("data-editing")).toBe("false");
  });
});

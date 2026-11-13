import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dashboard, DashboardWidget } from "../../api/audit";
import AuditAnalytics from "./AuditAnalytics";

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  getDashboard: vi.fn(),
  save: vi.fn(),
  query: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../api/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/audit")>()),
  getAuditSummary: mocks.summary,
  getDashboard: mocks.getDashboard,
  saveDashboard: mocks.save,
  queryAudit: mocks.query,
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.toast }) }));
// A grade tem teste proprio; aqui ela mostra o que recebeu e expoe os botoes de configurar e remover
vi.mock("./dashboard/DashboardGrid", () => ({
  default: (props: {
    widgets: DashboardWidget[];
    editing: boolean;
    onEditWidget?: (id: string) => void;
    onRemoveWidget?: (id: string) => void;
  }) => (
    <div data-testid="grid">
      {props.widgets.map((w) => (
        <span key={w.id}>
          <span>{`${w.id}@${w.x},${w.y}`}</span>
          <button onClick={() => props.onEditWidget?.(w.id)}>{`configurar ${w.id}`}</button>
          <button onClick={() => props.onRemoveWidget?.(w.id)}>{`remover ${w.id}`}</button>
        </span>
      ))}
    </div>
  ),
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

const dashboard = (over: Partial<Dashboard> = {}): Dashboard => ({
  widgets: WIDGETS,
  columns: 20,
  is_default: true,
  updated_at: null,
  updated_by: null,
  ...over,
});

beforeEach(() => {
  mocks.summary.mockReset().mockResolvedValue(SUMMARY);
  mocks.getDashboard.mockReset().mockResolvedValue(dashboard());
  mocks.save.mockReset();
  mocks.query.mockReset().mockResolvedValue({
    metric: "events",
    metric_label: "Eventos",
    group_by: "action",
    rows: [{ key: "login", label: "Login", value: 5 }],
    total: 5,
    timezone: "UTC",
  });
  mocks.toast.mockReset();
});

const open = (filters = {}) => render(<AuditAnalytics filters={filters} canCreate canEdit canDelete />);
const startEditing = async (filters = {}) => {
  open(filters);
  fireEvent.click(await screen.findByRole("button", { name: /Editar painel/ }));
};
const saved = () => mocks.save.mock.calls[0][0] as DashboardWidget[];
const saveButton = () => screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement;

describe("AuditAnalytics - adicionar, configurar e remover visuais", () => {
  it("Adicionar visual so existe no modo de edicao", async () => {
    open();
    await screen.findByTestId("grid");
    expect(screen.queryByRole("button", { name: "Adicionar visual" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Editar painel/ }));

    expect(screen.getByRole("button", { name: "Adicionar visual" })).toBeTruthy();
  });

  it("monta um visual novo, ele entra no fim do painel e vai no Salvar", async () => {
    mocks.save.mockImplementation(async (widgets: DashboardWidget[]) => dashboard({ widgets, is_default: false }));
    await startEditing();
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Adicionar visual" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Novo visual")).toBeTruthy();
    fireEvent.change(dialog.getByLabelText("Titulo"), { target: { value: "Meu visual" } });
    fireEvent.click(dialog.getByRole("button", { name: "Adicionar visual" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/^w[a-z0-9]+@0,8$/)).toBeTruthy(); // abaixo do ultimo visual (y 2 + h 6)
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Painel salvo para todos."));
    expect(saved()).toHaveLength(3);
    expect(saved()[2]).toMatchObject({ source: "custom", title: "Meu visual", x: 0, y: 8, w: 10, h: 7 });
    expect(saved()[2].query).toEqual({ metric: "events", group_by: "action", limit: 8, filters: null });
  });

  it("cada visual novo ganha um id diferente", async () => {
    await startEditing();
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Adicionar visual" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Adicionar visual" }));
    }

    const ids = screen.getAllByText(/@/).map((el) => el.textContent!.split("@")[0]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("Remover tira o visual do painel e habilita o Salvar; Cancelar descarta", async () => {
    await startEditing();

    fireEvent.click(screen.getByRole("button", { name: "remover a" }));

    expect(screen.queryByText("a@0,0")).toBeNull();
    expect(screen.getByText("b@0,2")).toBeTruthy();
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar" }));
    expect(screen.getByText("a@0,0")).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("painel sem nenhum visual mostra o aviso para adicionar", async () => {
    await startEditing();
    fireEvent.click(screen.getByRole("button", { name: "remover a" }));
    fireEvent.click(screen.getByRole("button", { name: "remover b" }));

    expect(screen.getByText(/O painel esta vazio/)).toBeTruthy();
    expect(screen.getByText(/Use Adicionar visual/)).toBeTruthy();
  });

  it("Configurar abre o visual com os dados dele; Aplicar muda titulo e cor, e isso conta como mudanca", async () => {
    mocks.save.mockImplementation(async (widgets: DashboardWidget[]) => dashboard({ widgets, is_default: false }));
    await startEditing();
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "configurar a" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Configurar visual")).toBeTruthy();
    fireEvent.change(dialog.getByLabelText("Titulo"), { target: { value: "Total de eventos" } });
    fireEvent.click(dialog.getByRole("radio", { name: "Vermelho" }));
    fireEvent.click(dialog.getByRole("button", { name: "Aplicar" }));

    expect(saveButton().disabled).toBe(false); // so mudou titulo e cor, nao a posicao
    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(saved()[0]).toMatchObject({ id: "a", title: "Total de eventos", color: "danger", x: 0, y: 0 });
    expect(saved()[1]).toMatchObject({ id: "b", title: null }); // o outro visual nao foi tocado
  });

  it("fechar a janela sem aplicar nao muda o painel", async () => {
    await startEditing();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar visual" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByText(/@/)).toHaveLength(2);
    expect(saveButton().disabled).toBe(true);
  });

  it("os filtros da pagina chegam a pre-visualizacao do editor", async () => {
    await startEditing({ date_from: "2026-11-01" });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar visual" }));

    await waitFor(() =>
      expect(mocks.query).toHaveBeenCalledWith({ date_from: "2026-11-01" }, { metric: "events", group_by: "action", limit: 8, filters: null }),
    );
  });
});

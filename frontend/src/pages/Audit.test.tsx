import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Audit from "./Audit";

const mocks = vi.hoisted(() => ({
  platformAdmin: true,
  options: vi.fn(),
  table: vi.fn(),
  analytics: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { is_platform_admin: mocks.platformAdmin } }) }));
vi.mock("../context/BrandingContext", () => ({ useBranding: () => ({ settings: { timezone: "America/Sao_Paulo" } }) }));
vi.mock("../api/audit", () => ({ getAuditOptions: mocks.options }));
// Tabela e analiticos fazem chamadas de rede; aqui so importa o que a pagina entrega a cada um
vi.mock("../components/audit/AuditTable", () => ({
  default: (props: unknown) => {
    mocks.table(props);
    return <div data-testid="records">registros</div>;
  },
}));
vi.mock("../components/audit/AuditAnalytics", () => ({
  default: (props: unknown) => {
    mocks.analytics(props);
    return <div data-testid="analytics">analiticos</div>;
  },
}));

function renderAt(url = "/audit") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/audit" element={<Audit />} />
        <Route path="/" element={<div data-testid="home">inicio</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.platformAdmin = true;
  mocks.options.mockReset();
  mocks.options.mockResolvedValue({
    actions: [{ action: "login", label: "Login" }],
    users: [{ id: 7, name: "Ana Lima", email: "ana@example.com" }],
    collections: [{ id: 2, name: "Financeiro" }],
    reports: [],
  });
  mocks.table.mockReset();
  mocks.analytics.mockReset();
  window.localStorage.clear();
});

const lastProps = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as { filters: Record<string, unknown> };
const lastTableProps = () => mocks.table.mock.calls[mocks.table.mock.calls.length - 1][0] as Record<string, unknown>;

describe("Audit", () => {
  it("quem nao e administrador da plataforma volta para o inicio", () => {
    mocks.platformAdmin = false;
    renderAt();
    expect(screen.queryByTestId("home")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Auditoria" })).toBeNull();
  });

  it("abre na aba Registros, com duas abas e o fuso no texto", () => {
    renderAt();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Auditoria");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["table_rowsRegistros", "monitoringAnaliticos"]);
    expect(screen.queryByTestId("records")).not.toBeNull();
    expect(screen.queryByTestId("analytics")).toBeNull();
    expect(screen.getByText(/America\/Sao_Paulo/)).toBeTruthy();
  });

  it("trocar para Analiticos mostra os graficos, e a aba fica na URL", () => {
    renderAt();
    fireEvent.click(screen.getByRole("tab", { name: /Analiticos/ }));
    expect(screen.queryByTestId("analytics")).not.toBeNull();
    expect(screen.queryByTestId("records")).toBeNull();
  });

  it("?tab=analytics abre direto nos analiticos", () => {
    renderAt("/audit?tab=analytics");
    expect(screen.queryByTestId("analytics")).not.toBeNull();
  });

  it("o periodo padrao e 30 dias e os filtros chegam as duas abas do mesmo jeito", async () => {
    renderAt();
    const records = lastProps(mocks.table).filters;
    expect(records.date_from).toBeTruthy();
    expect(records.date_to).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Analiticos/ }));
    expect(lastProps(mocks.analytics).filters).toEqual(records);
  });

  it("pessoa, acao e colecao sao listas com busca e selecao multipla, com opcoes vindas do servidor", async () => {
    mocks.options.mockResolvedValue({
      actions: [
        { action: "login", label: "Login" },
        { action: "login_blocked", label: "Login bloqueado" },
      ],
      users: [
        { id: 7, name: "Ana Lima", email: "ana@example.com" },
        { id: 8, name: "Bruno Sa", email: "bruno@example.com" },
      ],
      collections: [{ id: 2, name: "Financeiro" }],
    });
    renderAt();

    fireEvent.click(screen.getByRole("button", { name: "Pessoa: Todas" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Ana Lima/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Bruno Sa/ }));

    fireEvent.click(screen.getByRole("button", { name: "Acao: Todas" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Login" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Login bloqueado" }));

    fireEvent.click(screen.getByRole("button", { name: "Colecao: Todas" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Financeiro" }));

    await waitFor(() =>
      expect(lastProps(mocks.table).filters).toMatchObject({
        user_id: [7, 8],
        action: ["login", "login_blocked"],
        workspace_id: [2],
      }),
    );
  });

  it("o filtro de relatorio lista os relatorios com a colecao e filtra por varios", async () => {
    mocks.options.mockResolvedValue({
      actions: [],
      users: [],
      collections: [],
      reports: [
        { id: 11, name: "Vendas por regiao", collection: "Comercial" },
        { id: 12, name: "Custo assistencial", collection: null },
      ],
    });
    renderAt();

    fireEvent.click(screen.getByRole("button", { name: "Relatorio: Todas" }));
    expect(await screen.findByText("Colecao: Comercial")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Vendas por regiao/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Custo assistencial/ }));

    await waitFor(() => expect(lastProps(mocks.table).filters).toMatchObject({ report_id: [11, 12] }));
    expect(screen.getByRole("button", { name: "Limpar filtros" })).toBeTruthy(); // o filtro de relatorio conta como filtro ativo
  });

  it("clicar numa coluna da tabela aplica o filtro daquela coluna e ele aparece na barra de filtros", async () => {
    mocks.options.mockResolvedValue({
      actions: [{ action: "login", label: "Login" }],
      entities: [{ entity: "report", label: "Relatorio" }],
      users: [{ id: 7, name: "Ana Lima", email: "ana@example.com" }],
      collections: [{ id: 2, name: "Financeiro" }],
      reports: [],
    });
    renderAt();
    await waitFor(() => expect((lastTableProps().people as unknown[] | undefined)?.length).toBe(1));
    const filterBy = lastTableProps().onFilterBy as (patch: Record<string, unknown>) => void;

    act(() => filterBy({ userIds: ["7"] }));
    await waitFor(() => expect(lastProps(mocks.table).filters).toMatchObject({ user_id: [7] }));

    act(() => filterBy({ entities: ["report"] }));
    await waitFor(() => expect(lastProps(mocks.table).filters).toMatchObject({ user_id: [7], entity: ["report"] }));
    // O que foi clicado fica visivel e pode ser limpo
    expect(screen.getByRole("button", { name: "Recurso: Relatorio" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pessoa: Ana Lima" })).toBeTruthy();

    act(() => filterBy({ period: "custom", customFrom: "2026-11-10", customTo: "2026-11-10" }));
    await waitFor(() =>
      expect(lastProps(mocks.table).filters).toMatchObject({ date_from: "2026-11-10", date_to: "2026-11-10" }),
    );
    expect((screen.getByLabelText("Periodo") as HTMLSelectElement).value).toBe("custom");

    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(lastProps(mocks.table).filters.entity).toBeUndefined();
    expect(lastProps(mocks.table).filters.user_id).toBeUndefined();
  });

  it("o filtro Recurso e uma lista com busca e selecao multipla", async () => {
    mocks.options.mockResolvedValue({
      actions: [],
      entities: [
        { entity: "report", label: "Relatorio" },
        { entity: "workspace", label: "Colecao" },
      ],
      users: [],
      collections: [],
      reports: [],
    });
    renderAt();

    fireEvent.click(screen.getByRole("button", { name: "Recurso: Todas" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Relatorio" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Colecao" }));

    await waitFor(() => expect(lastProps(mocks.table).filters).toMatchObject({ entity: ["report", "workspace"] }));
  });

  it("buscar dentro da lista de pessoas encontra pelo email", async () => {
    renderAt();
    fireEvent.click(screen.getByRole("button", { name: "Pessoa: Todas" }));
    await screen.findByRole("checkbox", { name: /Ana Lima/ });

    fireEvent.change(screen.getByLabelText("Pesquisar em Pessoa"), { target: { value: "ana@" } });

    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("o periodo e uma lista suspensa, sem botoes, com 30 dias como padrao", () => {
    renderAt();
    const period = screen.getByLabelText("Periodo") as HTMLSelectElement;

    expect(period.tagName).toBe("SELECT");
    expect(period.value).toBe("30d");
    expect(Array.from(period.options).map((o) => o.textContent)).toEqual([
      "Hoje",
      "Ultimos 7 dias",
      "Ultimos 30 dias",
      "Ultimos 90 dias",
      "Todo o periodo",
      "Personalizado",
    ]);
    expect(screen.queryByRole("button", { name: "Hoje" })).toBeNull();
  });

  it("Todo o periodo tira as datas e Limpar filtros volta ao padrao", async () => {
    renderAt();
    fireEvent.change(screen.getByLabelText("Periodo"), { target: { value: "all" } });
    expect(lastProps(mocks.table).filters.date_from).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(lastProps(mocks.table).filters.date_from).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Limpar filtros" })).toBeNull();
  });

  it("periodo personalizado mostra os campos de data e usa o que foi escolhido", () => {
    renderAt();
    expect(screen.queryByLabelText("De")).toBeNull();
    fireEvent.change(screen.getByLabelText("Periodo"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Ate"), { target: { value: "2026-10-31" } });

    expect(lastProps(mocks.table).filters).toMatchObject({ date_from: "2026-10-01", date_to: "2026-10-31" });
  });

  it("se as opcoes nao carregarem, a pagina continua funcionando", async () => {
    mocks.options.mockRejectedValue(new Error("falhou"));
    renderAt();
    expect(screen.queryByTestId("records")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Pessoa: Todas" })).toBeTruthy();
  });
});

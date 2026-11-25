import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../api/access";
import type { CatalogItem, ItemsPage, TenantWorkspace } from "../api/workspaceCatalog";
import { AccessContext, buildAccess } from "../context/AccessContext";
import Reports from "./Reports";

const mocks = vi.hoisted(() => ({
  listTenantWorkspaces: vi.fn(),
  listItems: vi.fn(),
  refreshDataset: vi.fn(),
  getDatasetHistory: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../api/workspaceCatalog", () => ({
  listTenantWorkspaces: mocks.listTenantWorkspaces,
  listItems: mocks.listItems,
  refreshDataset: mocks.refreshDataset,
  getDatasetHistory: mocks.getDatasetHistory,
}));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
// As janelas e o painel tem teste proprio
vi.mock("../components/reports/PermissionsPanel", () => ({ default: ({ itemName }: { itemName: string }) => <div data-testid="painel">{itemName}</div> }));
vi.mock("../components/DatasetSecurityModal", () => ({ default: ({ datasetName }: { datasetName: string }) => <div data-testid="seguranca">{datasetName}</div> }));
vi.mock("../components/CatalogSyncModal", () => ({ default: () => <div data-testid="sincronizar" /> }));
vi.mock("../components/reports/ReportsModals", () => ({
  FoldersModal: ({ reports }: { reports: unknown[] }) => <div data-testid="pastas">{reports.length}</div>,
  HistoryModal: () => <div data-testid="historico" />,
  BulkShareModal: ({ items }: { items: unknown[] }) => <div data-testid="lote">{items.length}</div>,
}));

const ws = (parts: Partial<TenantWorkspace> = {}): TenantWorkspace => ({
  connection_id: 1, connection_name: "Conta", pbi_workspace_id: "ws-a", name: "Financeiro", reports: 3, datasets: 2, last_synced_at: "2026-11-25T10:00:00Z", pending: 2, ...parts,
});

function item(parts: Partial<CatalogItem> = {}): CatalogItem {
  return {
    kind: "report", id: 1, name: "Resultado", connection_id: 1, pbi_workspace_id: "ws-a", pbi_workspace_name: "Financeiro", collection_id: 5, folders: [], in_root: true,
    updated_at: "2026-11-25T10:00:00Z", last_refresh_at: null, next_refresh_at: null, last_refresh_status: null, missing: false, dataset_id: 9, dataset_name: "Modelo financeiro", rls: { requires_identity: null, role_grants: 0 },
    access: { count: 0, people: [] }, pending: true,
    can: { open: true, share: true, security: false, refresh: false, history: false, folders: true },
    ...parts,
  };
}

function page(items: CatalogItem[], parts: Partial<ItemsPage> = {}): ItemsPage {
  return { items, total: items.length, page: 1, page_size: 25, pending_total: items.filter((i) => i.pending).length, ...parts };
}

function renderPage(me: Partial<MyAccess>, url = "/catalog") {
  const access = buildAccess({ is_admin: false, global_permissions: [], workspace_permissions: {}, ...me });
  return render(
    <AccessContext.Provider value={access}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/catalog" element={<Reports />} />
          <Route path="/" element={<div data-testid="inicio" />} />
          <Route path="/settings" element={<div data-testid="configuracoes" />} />
          <Route path="/collection/:w/report/:r" element={<div data-testid="relatorio" />} />
        </Routes>
      </MemoryRouter>
    </AccessContext.Provider>,
  );
}

const admin: Partial<MyAccess> = { is_admin: true };

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.listTenantWorkspaces.mockResolvedValue([ws(), ws({ pbi_workspace_id: "ws-b", name: "Comercial", reports: 1, datasets: 0, pending: 0, last_synced_at: null })]);
  mocks.listItems.mockResolvedValue(page([item(), item({ kind: "dataset", id: 9, name: "Modelo financeiro", pending: false, dataset_id: 9, reports_count: 2, rls: { requires_identity: true, role_grants: 2 }, can: { open: false, share: true, security: true, refresh: true, history: true, folders: false }, access: { count: 3, people: [{ kind: "user", name: "Ana Souza", picture_url: null }, { kind: "group", name: "Diretoria", picture_url: null }] } })]));
});

describe("Reports: a entrada", () => {
  it("quem nao tem nada volta para o inicio", () => {
    renderPage({ global_permissions: ["sistema.geral"] });

    expect(screen.getByTestId("inicio")).toBeTruthy();
  });

  it("lista os workspaces com contagens, sincronizacao e o total de novos", async () => {
    renderPage(admin);

    expect(await screen.findByText("Financeiro")).toBeTruthy();
    expect(screen.getByText("Comercial")).toBeTruthy();
    expect(screen.getByText(/3 relatórios/)).toBeTruthy();
    expect(screen.getByText(/ainda não sincronizado/)).toBeTruthy();
    expect(screen.getByLabelText("2 relatórios novos sem acesso")).toBeTruthy();
  });

  it("a busca de workspaces e instantanea e vai para o servidor", async () => {
    renderPage(admin);
    await screen.findByText("Financeiro");

    fireEvent.change(screen.getByLabelText("Buscar workspace"), { target: { value: "comerc" } });

    await waitFor(() => expect(mocks.listTenantWorkspaces).toHaveBeenLastCalledWith("comerc"));
  });

  it("sem nenhum workspace mostra a acao certa para quem pode sincronizar", async () => {
    mocks.listTenantWorkspaces.mockResolvedValue([]);
    renderPage({ is_admin: false, global_permissions: ["conexao.sincronizar", "relatorio.catalogo"] });

    fireEvent.click(await screen.findByRole("button", { name: "Ir para as contas do Power BI" }));

    expect(screen.getByTestId("configuracoes")).toBeTruthy();
  });

  it("sem nenhum workspace, quem so recebe itens ve uma explicacao e nenhum botao", async () => {
    mocks.listTenantWorkspaces.mockResolvedValue([]);
    renderPage({ is_admin: false, report_permissions: { "1": ["relatorio.ver"] } });

    expect(await screen.findByText(/Quando alguém compartilhar/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /contas do Power BI/ })).toBeNull();
  });

  it("endereco de um workspace que nao existe volta para a lista", async () => {
    renderPage(admin, "/catalog?ws=9~nao-existe");

    expect(await screen.findByText("Financeiro")).toBeTruthy();
  });
});

describe("Reports: dentro de um workspace", () => {
  async function abrir(me: Partial<MyAccess> = admin) {
    renderPage(me);
    fireEvent.click(await screen.findByRole("button", { name: /Financeiro/ }));
    await screen.findByText("Resultado");
  }

  it("mostra o cabecalho, o botao principal e a tabela com relatorios e modelos", async () => {
    await abrir();

    expect(screen.getByRole("heading", { name: "Financeiro" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sincronizar" })).toBeTruthy();
    expect(screen.getByText("Resultado")).toBeTruthy();
    expect(screen.getByText("Modelo financeiro")).toBeTruthy();
    expect(screen.getByText("2 funções")).toBeTruthy();
    expect(screen.getByLabelText("3 pessoas e grupos com acesso")).toBeTruthy();
    expect(screen.getAllByText("Novo").length).toBe(1);
  });

  it("sem a permissao de sincronizar nao ha botao principal", async () => {
    await abrir({ is_admin: false, global_permissions: ["relatorio.catalogo", "modelo.catalogo"] });

    expect(screen.queryByRole("button", { name: "Sincronizar" })).toBeNull();
  });

  it("filtra por tipo e busca, sempre no servidor e voltando para a primeira pagina", async () => {
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: "Modelos semânticos" }));
    await waitFor(() => expect(mocks.listItems).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "dataset", page: 1, workspace: "ws-a" })));
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "fin" } });
    await waitFor(() => expect(mocks.listItems).toHaveBeenLastCalledWith(expect.objectContaining({ search: "fin" })));
  });

  it("o indicador de novos sem acesso filtra com um clique", async () => {
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: /1 novo sem acesso/ }));

    await waitFor(() => expect(mocks.listItems).toHaveBeenLastCalledWith(expect.objectContaining({ pending: true })));
  });

  it("ordena clicando no titulo da coluna e inverte no segundo clique", async () => {
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: "Acesso" }));
    await waitFor(() => expect(mocks.listItems).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "access", order: "asc" })));
    fireEvent.click(screen.getByRole("button", { name: /Acesso/ }));
    await waitFor(() => expect(mocks.listItems).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "access", order: "desc" })));
  });

  it("abrir um relatorio vai para a tela dele e compartilhar abre o painel lateral", async () => {
    await abrir();

    fireEvent.click(screen.getAllByRole("button", { name: "Compartilhar" })[0]);
    expect(screen.getByTestId("painel").textContent).toBe("Resultado");
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(screen.getByTestId("relatorio")).toBeTruthy();
  });

  it("o menu das tres pontinhas do modelo tem as acoes dele e atualizar pede ao Power BI", async () => {
    mocks.refreshDataset.mockResolvedValue(undefined);
    await abrir();

    const linha = screen.getByText("Modelo financeiro").closest("tr") as HTMLElement;
    fireEvent.click(within(linha).getByRole("button", { name: "Mais opcoes" }));
    fireEvent.click(await screen.findByText("Atualizar agora"));

    await waitFor(() => expect(mocks.refreshDataset).toHaveBeenCalledWith(9));
    expect(mocks.showToast).toHaveBeenCalledWith("Atualização pedida ao Power BI.");
  });

  it("a selecao em varios itens mostra a barra de lote com Compartilhar e Pastas so quando cabem", async () => {
    await abrir();

    fireEvent.click(screen.getByLabelText("Selecionar Resultado"));
    const barra = screen.getByRole("region", { name: "Ações em lote" });
    expect(barra.textContent).toMatch(/1 selecionado/);
    fireEvent.click(within(barra).getByRole("button", { name: "Pastas" }));
    expect(screen.getByTestId("pastas").textContent).toBe("1");
    fireEvent.click(screen.getByLabelText("Selecionar Modelo financeiro"));
    expect(within(screen.getByRole("region", { name: "Ações em lote" })).queryByRole("button", { name: "Pastas" })).toBeNull(); // um modelo no meio: pastas nao se aplica
    fireEvent.click(within(barra).getByRole("button", { name: "Compartilhar" }));
    expect(screen.getByTestId("lote").textContent).toBe("2");
  });

  it("sem selecao nao ha barra de lote", async () => {
    await abrir();

    expect(screen.queryByRole("region", { name: "Ações em lote" })).toBeNull();
  });

  it("estado vazio com filtro oferece limpar e sem filtro oferece sincronizar", async () => {
    mocks.listItems.mockResolvedValue(page([], { pending_total: 0 }));
    renderPage(admin);
    fireEvent.click(await screen.findByRole("button", { name: /Financeiro/ }));

    expect(await screen.findByText("Este workspace está vazio")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Sincronizar/ }).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "xyz" } });
    expect(await screen.findByText("Nada encontrado")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Limpar filtros" })).toBeTruthy();
  });

  it("a linhagem agrupa os relatorios por modelo e separa os sem modelo", async () => {
    mocks.listItems.mockResolvedValue(page([item(), item({ id: 2, name: "Sem modelo", dataset_id: null, pending: false }), item({ kind: "dataset", id: 9, name: "Modelo financeiro", pending: false, dataset_id: 9, can: { open: false, share: true, security: true, refresh: true, history: true, folders: false } })]));
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: "Linhagem" }));

    expect(await screen.findByText("Relatórios sem modelo conhecido")).toBeTruthy();
    await waitFor(() => expect(mocks.listItems).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "all", pageSize: 100 })));
  });

  it("erro do servidor aparece na tela", async () => {
    renderPage(admin);
    fireEvent.click(await screen.findByRole("button", { name: /Financeiro/ }));
    mocks.listItems.mockReset();
    mocks.listItems.mockRejectedValue({ response: { data: { detail: "Falha qualquer" } } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "a" } });

    expect((await screen.findByRole("alert")).textContent).toMatch(/Falha qualquer/);
  });

  it("paginacao aparece so quando ha mais de uma pagina", async () => {
    mocks.listItems.mockResolvedValue(page([item()], { total: 60 }));
    await abrir();

    expect(screen.getByText(/60 itens · página 1 de 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(mocks.listItems).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as homeApi from "../api/home";
import * as reportsApi from "../api/reports";
import type { Report } from "../api/reports";
import type { Workspace } from "../api/workspaces";
import { AccessContext, buildAccess } from "../context/AccessContext";
import { makeReport, makeWorkspace } from "../test-fixtures";
import { preloadPowerBi } from "../utils/powerbiService";
import CollectionHome from "./CollectionHome";

const mocks = vi.hoisted(() => ({
  workspace: null as Workspace | null,
  reload: vi.fn(),
  showToast: vi.fn(),
  toggleFavorite: vi.fn(),
  podeEnviarPorEmail: false,
  permissoes: [] as string[],
}));

vi.mock("../context/WorkspaceContext", () => ({
  useWorkspace: () => ({ currentWorkspace: mocks.workspace, reload: mocks.reload }),
}));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, name: "Admin", email: "admin@empresa.com" } }) }));
vi.mock("../hooks/useCanSendByEmail", () => ({ useCanSendByEmail: () => mocks.podeEnviarPorEmail }));
vi.mock("../components/SendReportEmailModal", () => ({
  default: ({ report, workspaceId, defaultEmail, onClose }: { report: Report; workspaceId: number; defaultEmail: string; onClose: () => void }) => (
    <div data-testid="modal-email">
      <span>{`${report.name}|${workspaceId}|${defaultEmail}`}</span>
      <button onClick={onClose}>fechar email</button>
    </div>
  ),
}));
vi.mock("../context/FavoritesContext", () => ({
  useFavorites: () => ({ favoriteIds: new Set<number>(), toggleFavorite: mocks.toggleFavorite }),
}));
vi.mock("../api/home", () => ({ recordCollectionView: vi.fn() }));
vi.mock("../api/reports", () => ({
  listReports: vi.fn(),
  deleteReport: vi.fn(),
  moveReport: vi.fn(),
  getCollectionRefreshInfo: vi.fn(),
}));
vi.mock("../api/workspaces", () => ({ updateWorkspace: vi.fn() }));

// Componentes que falam com o Power BI ou com a rede viram stubs; o resto da pagina roda de verdade
vi.mock("../components/ReportEmbed", () => ({
  default: ({ reportId }: { reportId: number }) => <div data-testid={`embed-${reportId}`} />,
}));
vi.mock("../components/ReportThumbnail", () => ({ default: () => null }));
vi.mock("../utils/powerbiService", () => ({ preloadPowerBi: vi.fn() }));
vi.mock("../components/LazyMount", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../components/NewReportForm", () => ({ default: () => null }));
// O caminho e as subpastas tem teste proprio (FolderNav.test.tsx)
vi.mock("../components/FolderNav", () => ({ default: () => null }));
vi.mock("../components/EditCollectionModal", () => ({ default: () => null }));
vi.mock("../components/FullscreenReportView", () => ({
  default: ({ reports, onExit }: { reports: Report[]; onExit: () => void }) => (
    <div data-testid="fullscreen-section">
      <span>{`apresentacao:${reports.length}`}</span>
      <button onClick={onExit}>sair da secao</button>
    </div>
  ),
}));

const listReports = vi.mocked(reportsApi.listReports);
const moveReport = vi.mocked(reportsApi.moveReport);
const recordCollectionView = vi.mocked(homeApi.recordCollectionView);
const getCollectionRefreshInfo = vi.mocked(reportsApi.getCollectionRefreshInfo);

// 6 relatorios: o campo de filtro so aparece a partir de 6
const REPORTS: Report[] = [
  makeReport(1, { name: "Vendas Mensal" }),
  makeReport(2, { name: "Vendas Anual" }),
  makeReport(3, { name: "Estoque Atual" }),
  makeReport(4, { name: "Painel Geral", display_type: "painel" }),
  makeReport(5, { name: "Apresentacao A", display_type: "apresentacao" }),
  makeReport(6, { name: "Apresentacao B", display_type: "apresentacao" }),
];

// Pagina de mentira da tela cheia de um relatorio: mostra os numeros que vieram no endereco
function PaginaDoRelatorio() {
  const { workspaceId, reportId } = useParams();
  return <div data-testid="pagina-relatorio">{`${workspaceId}/${reportId}`}</div>;
}

// O que cada papel antigo faz, escrito como as permissoes de hoje: a pagina decide por elas, nao pelo papel
const DO_EDITOR = [
  "relatorio.publicar",
  "relatorio.editar",
  "relatorio.reordenar",
  "relatorio.miniatura",
  "relatorio.excluir",
  "powerbi.atualizar",
];
const PERMISSOES_POR_PAPEL: Record<Workspace["role"], string[]> = {
  viewer: ["colecao.ver"],
  editor: ["colecao.ver", ...DO_EDITOR],
  admin: ["colecao.ver", ...DO_EDITOR, "colecao.editar", "colecao.excluir", "colecao.auditoria"],
};

/** A colecao dentro de um roteador de memoria, com a rota da pagina de tela cheia do relatorio */
function montar(entrada: string | { pathname: string; state?: unknown } = "/collection") {
  const acesso = buildAccess({ is_admin: false, global_permissions: [], workspace_permissions: { "3": mocks.permissoes } });
  return (
    <AccessContext.Provider value={acesso}>
      <MemoryRouter initialEntries={[entrada]}>
        <Routes>
          <Route path="/collection" element={<CollectionHome />} />
          <Route path="/collection/:workspaceId/report/:reportId" element={<PaginaDoRelatorio />} />
        </Routes>
      </MemoryRouter>
    </AccessContext.Provider>
  );
}

function comRole(role: Workspace["role"]) {
  mocks.workspace = makeWorkspace({ id: 3, name: "Colecao Vendas", role });
  mocks.permissoes = PERMISSOES_POR_PAPEL[role];
}

/** A colecao com so as permissoes escolhidas (alem de ver a colecao) */
function comPermissoes(...chaves: string[]) {
  mocks.workspace = makeWorkspace({ id: 3, name: "Colecao Vendas", role: "viewer" });
  mocks.permissoes = ["colecao.ver", ...chaves];
}

async function renderLoaded() {
  const utils = render(montar());
  await screen.findByRole("heading", { name: "Relatorios" });
  return utils;
}

function digitarFiltro(texto: string) {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: texto } });
}

beforeEach(() => {
  window.localStorage.clear();
  comRole("admin");
  mocks.podeEnviarPorEmail = false;
  mocks.reload.mockReset();
  mocks.reload.mockResolvedValue(undefined);
  mocks.showToast.mockClear();
  listReports.mockResolvedValue(REPORTS);
  recordCollectionView.mockResolvedValue(undefined);
  getCollectionRefreshInfo.mockResolvedValue({});
});

describe("CollectionHome - carga e secoes", () => {
  it("nao renderiza nada nem chama a API sem colecao selecionada", () => {
    mocks.workspace = null;
    const { container } = render(montar());

    expect(container.firstChild).toBeNull();
    expect(listReports).not.toHaveBeenCalled();
  });

  it("mostra o nome da colecao e uma secao por tipo de relatorio", async () => {
    await renderLoaded();

    expect(screen.getByRole("heading", { name: "Colecao Vendas" })).toBeTruthy();
    for (const titulo of ["Relatorios", "Painel", "Apresentacao"]) {
      expect(screen.getByRole("heading", { name: titulo })).toBeTruthy();
    }
    expect(listReports).toHaveBeenCalledWith(3);
  });

  it("registra a visita a colecao em Recentes uma vez ao abrir", async () => {
    await renderLoaded();

    expect(recordCollectionView).toHaveBeenCalledTimes(1);
    expect(recordCollectionView).toHaveBeenCalledWith(3);
  });

  it("avisa quando uma colecao nao tem relatorios", async () => {
    listReports.mockResolvedValue([]);
    render(montar());

    expect(await screen.findByText("Nenhum relatorio nesta colecao ainda.")).toBeTruthy();
  });

  it("avisa com um toast quando a lista nao carrega", async () => {
    listReports.mockRejectedValue(new Error("rede"));
    render(montar());

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith("Nao foi possivel carregar os relatorios desta colecao.", "error"),
    );
  });
});

describe("CollectionHome - carregar menos coisas ao mesmo tempo", () => {
  it("pre-carrega o Power BI em segundo plano ao abrir a colecao", async () => {
    await renderLoaded();

    await waitFor(() => expect(preloadPowerBi).toHaveBeenCalledTimes(1));
  });

  it("no modo lista so o relatorio aberto fica montado; abrir outro desmonta o anterior", async () => {
    await renderLoaded();
    fireEvent.click(screen.getAllByTitle("Ver como lista")[0]);
    expect(screen.queryByTestId("embed-1")).toBeNull();

    fireEvent.click(screen.getByText("Vendas Mensal"));
    expect(screen.getByTestId("embed-1")).toBeTruthy();

    fireEvent.click(screen.getByText("Vendas Anual"));
    expect(screen.queryByTestId("embed-1")).toBeNull();
    expect(screen.getByTestId("embed-2")).toBeTruthy();
    expect(screen.getAllByTestId(/^embed-/)).toHaveLength(1);
  });

  it("fechar o relatorio aberto desmonta o embed (nao fica escondido rodando)", async () => {
    await renderLoaded();
    fireEvent.click(screen.getAllByTitle("Ver como lista")[0]);
    fireEvent.click(screen.getByText("Vendas Mensal"));
    expect(screen.getByTestId("embed-1")).toBeTruthy();

    fireEvent.click(screen.getByText("Vendas Mensal"));

    expect(screen.queryByTestId("embed-1")).toBeNull();
  });
});

describe("CollectionHome - enviar relatorio por e-mail", () => {
  // O menu do primeiro cartao (Vendas Mensal): vem depois do menu da colecao
  function abrirMenuDoPrimeiroCartao() {
    fireEvent.click(screen.getAllByLabelText("Mais opcoes")[1]);
  }

  it("sem permissao ou sem e-mail configurado o item nao aparece", async () => {
    await renderLoaded();

    abrirMenuDoPrimeiroCartao();

    expect(screen.queryByRole("button", { name: "Enviar por e-mail" })).toBeNull();
  });

  it("com permissao e e-mail configurado o item aparece e abre a janela com o relatorio e o e-mail de quem esta logado", async () => {
    mocks.podeEnviarPorEmail = true;
    await renderLoaded();

    abrirMenuDoPrimeiroCartao();
    fireEvent.click(screen.getByRole("button", { name: "Enviar por e-mail" }));

    expect(screen.getByTestId("modal-email").textContent).toContain("Vendas Mensal|3|admin@empresa.com");
  });

  it("fechar a janela volta para a colecao", async () => {
    mocks.podeEnviarPorEmail = true;
    await renderLoaded();
    abrirMenuDoPrimeiroCartao();
    fireEvent.click(screen.getByRole("button", { name: "Enviar por e-mail" }));

    fireEvent.click(screen.getByRole("button", { name: "fechar email" }));

    expect(screen.queryByTestId("modal-email")).toBeNull();
  });
});

// O primeiro "Mais opcoes" da pagina e o menu da colecao (vem antes dos menus dos cards)
function abrirMenuDaColecao() {
  fireEvent.click(screen.getAllByLabelText("Mais opcoes")[0]);
}

describe("CollectionHome - atualizacoes dos relatorios", () => {
  it("nao busca nem mostra a atualizacao nos cards: so a janela do menu mostra", async () => {
    getCollectionRefreshInfo.mockResolvedValue({
      "1": { last_refresh: "2026-11-03T12:00:00Z", next_refresh: null, last_status: "Completed" },
    });
    await renderLoaded();

    expect(getCollectionRefreshInfo).not.toHaveBeenCalled();
    expect(screen.queryByText(/Ultima atualizacao:/)).toBeNull();
  });

  it("o menu da colecao abre a tabela de atualizacoes com os relatorios", async () => {
    getCollectionRefreshInfo.mockResolvedValue({
      "1": { last_refresh: "2026-11-03T12:00:00Z", next_refresh: null, last_status: "Failed" },
    });
    await renderLoaded();

    abrirMenuDaColecao();
    fireEvent.click(screen.getByRole("button", { name: "Atualizacoes" }));

    expect(await screen.findByRole("table")).toBeTruthy();
    expect(getCollectionRefreshInfo).toHaveBeenCalledTimes(1);
    expect(getCollectionRefreshInfo).toHaveBeenCalledWith(3);
    // Uma linha por relatorio da colecao, sem o filtro da pagina
    expect(screen.getAllByRole("row")).toHaveLength(REPORTS.length + 1);
    expect(screen.getByText("Falhou")).toBeTruthy();
  });

  it("quem so le tambem ve o item Atualizacoes, mas nao os de edicao", async () => {
    comRole("viewer");
    await renderLoaded();

    abrirMenuDaColecao();

    expect(screen.getByRole("button", { name: "Atualizacoes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ Adicionar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar colecao" })).toBeNull();
  });

  it("a tabela mostra todos os relatorios mesmo com a pagina filtrada", async () => {
    await renderLoaded();
    digitarFiltro("Estoque");

    abrirMenuDaColecao();
    fireEvent.click(screen.getByRole("button", { name: "Atualizacoes" }));

    await screen.findByRole("table");
    expect(screen.getAllByRole("row")).toHaveLength(REPORTS.length + 1);
  });

  it("fecha a janela e volta para a colecao", async () => {
    await renderLoaded();
    abrirMenuDaColecao();
    fireEvent.click(screen.getByRole("button", { name: "Atualizacoes" }));
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("heading", { name: "Colecao Vendas" })).toBeTruthy();
  });
});

describe("CollectionHome - filtro por nome", () => {
  it("mostra so os relatorios que combinam e esconde as secoes que ficaram vazias", async () => {
    await renderLoaded();

    digitarFiltro("Estoque");

    expect(screen.getByText("Estoque Atual")).toBeTruthy();
    expect(screen.queryByText("Vendas Mensal")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Painel" })).toBeNull();
  });

  it("avisa quando nada combina com o filtro", async () => {
    await renderLoaded();

    digitarFiltro("zzz");

    expect(screen.getByText(/Nenhum relatorio encontrado para "zzz"/)).toBeTruthy();
  });

  it("limpa o filtro ao trocar de colecao", async () => {
    const { rerender } = await renderLoaded();
    digitarFiltro("Estoque");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("Estoque");

    mocks.workspace = makeWorkspace({ id: 9, name: "Outra colecao" });
    rerender(montar());

    await waitFor(() => expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(""));
  });
});

describe("CollectionHome - reordenar", () => {
  it("quem so le nao ve os botoes de reordenar", async () => {
    comRole("viewer");
    await renderLoaded();

    expect(screen.queryByLabelText(/^Mover /)).toBeNull();
  });

  it("quem edita ve os botoes so na Apresentacao, e o primeiro nao sobe", async () => {
    comRole("editor");
    await renderLoaded();

    expect(screen.getByLabelText("Mover Apresentacao A para baixo")).toBeTruthy();
    expect(screen.queryByLabelText("Mover Vendas Mensal para baixo")).toBeNull();
    expect((screen.getByLabelText("Mover Apresentacao A para cima") as HTMLButtonElement).disabled).toBe(true);
  });

  it("com filtro ativo os botoes somem, porque a secao mostrada e so uma parte", async () => {
    await renderLoaded();
    expect(screen.getByLabelText("Mover Apresentacao A para baixo")).toBeTruthy();

    digitarFiltro("Apresentacao");

    expect(screen.queryByLabelText(/^Mover /)).toBeNull();
  });

  it("mostra a ordem devolvida pelo servidor depois de mover", async () => {
    const reordenada = [REPORTS[0], REPORTS[1], REPORTS[2], REPORTS[3], REPORTS[5], REPORTS[4]];
    moveReport.mockResolvedValue(reordenada);
    await renderLoaded();
    const ordem = () => screen.getAllByText(/^Apresentacao [AB]$/).map((el) => el.textContent);
    expect(ordem()).toEqual(["Apresentacao A", "Apresentacao B"]);

    fireEvent.click(screen.getByLabelText("Mover Apresentacao A para baixo"));

    await waitFor(() => expect(ordem()).toEqual(["Apresentacao B", "Apresentacao A"]));
    expect(moveReport).toHaveBeenCalledWith(3, 5, "down");
  });
});

describe("CollectionHome - tela cheia", () => {
  it("clicar no cartao abre a pagina propria do relatorio, com colecao e relatorio no endereco", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText("Vendas Mensal").closest('[role="button"]') as HTMLElement);

    expect(screen.getByTestId("pagina-relatorio").textContent).toBe("3/1");
    expect(screen.queryByRole("heading", { name: "Colecao Vendas" })).toBeNull();
  });

  it("no modo lista, o botao de tela cheia do relatorio aberto tambem vai para a pagina dele", async () => {
    await renderLoaded();
    fireEvent.click(screen.getAllByTitle("Ver como lista")[0]);
    fireEvent.click(screen.getByText("Vendas Anual"));

    fireEvent.click(screen.getByTitle("Tela cheia"));

    expect(screen.getByTestId("pagina-relatorio").textContent).toBe("3/2");
  });

  it("a Apresentacao tambem usa a lista completa e volta para a pagina ao sair", async () => {
    await renderLoaded();
    digitarFiltro("Apresentacao A");

    fireEvent.click(screen.getByRole("button", { name: /Abrir apresentacao/ }));
    expect(screen.getByTestId("fullscreen-section").textContent).toContain("apresentacao:2");

    fireEvent.click(screen.getByRole("button", { name: "sair da secao" }));
    expect(screen.queryByTestId("fullscreen-section")).toBeNull();
    expect(screen.getByRole("heading", { name: "Colecao Vendas" })).toBeTruthy();
  });

});

describe("CollectionHome - cada acao pela sua permissao", () => {
  // O menu da colecao e o primeiro "Mais opcoes" da pagina; os menus dos relatorios vem depois
  const menuDaColecao = () => fireEvent.click(screen.getAllByLabelText("Mais opcoes")[0]);
  const menuDoPrimeiroRelatorio = () => fireEvent.click(screen.getAllByLabelText("Mais opcoes")[1]);
  const botao = (nome: string) => screen.queryByRole("button", { name: nome });

  it("so publicar mostra Adicionar e nao mostra Editar colecao", async () => {
    comPermissoes("relatorio.publicar");
    await renderLoaded();
    menuDaColecao();

    expect(botao("+ Adicionar")).not.toBeNull();
    expect(botao("Editar colecao")).toBeNull();
  });

  it("so editar a colecao mostra Editar colecao e nao mostra Adicionar", async () => {
    comPermissoes("colecao.editar");
    await renderLoaded();
    menuDaColecao();

    expect(botao("Editar colecao")).not.toBeNull();
    expect(botao("+ Adicionar")).toBeNull();
  });

  it("so editar um relatorio mostra Editar no menu dele, sem Excluir nem miniatura", async () => {
    comPermissoes("relatorio.editar");
    await renderLoaded();
    menuDoPrimeiroRelatorio();

    expect(botao("Editar")).not.toBeNull();
    expect(botao("Excluir")).toBeNull();
    expect(botao("Atualizar miniatura")).toBeNull();
  });

  it("so excluir mostra Excluir no menu do relatorio, sem Editar", async () => {
    comPermissoes("relatorio.excluir");
    await renderLoaded();
    menuDoPrimeiroRelatorio();

    expect(botao("Excluir")).not.toBeNull();
    expect(botao("Editar")).toBeNull();
  });

  it("so a miniatura mostra Atualizar miniatura, sem Editar nem Excluir", async () => {
    comPermissoes("relatorio.miniatura");
    await renderLoaded();
    menuDoPrimeiroRelatorio();

    expect(botao("Atualizar miniatura")).not.toBeNull();
    expect(botao("Editar")).toBeNull();
    expect(botao("Excluir")).toBeNull();
  });

  it("so reordenar mostra os botoes de mover, e nenhuma outra acao", async () => {
    comPermissoes("relatorio.reordenar");
    await renderLoaded();

    expect(screen.getByLabelText("Mover Apresentacao A para baixo")).toBeTruthy();
    menuDoPrimeiroRelatorio();
    expect(botao("Editar")).toBeNull();
    expect(botao("Excluir")).toBeNull();
  });

  it("editar relatorios nao libera os botoes de mover", async () => {
    comPermissoes("relatorio.editar", "relatorio.excluir", "relatorio.miniatura");
    await renderLoaded();

    expect(screen.queryByLabelText(/^Mover /)).toBeNull();
  });

  it("a permissao dada em outra colecao nao vale nesta", async () => {
    mocks.workspace = makeWorkspace({ id: 3, name: "Colecao Vendas", role: "viewer" });
    mocks.permissoes = ["colecao.ver"];
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText("Mais opcoes")[0]);
    expect(botao("+ Adicionar")).toBeNull();
    expect(botao("Editar colecao")).toBeNull();
  });
});

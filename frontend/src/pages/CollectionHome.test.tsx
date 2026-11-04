import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as homeApi from "../api/home";
import * as reportsApi from "../api/reports";
import type { Report } from "../api/reports";
import * as workspacesApi from "../api/workspaces";
import type { Workspace } from "../api/workspaces";
import { makeReport, makeWorkspace } from "../test-fixtures";
import { preloadPowerBi } from "../utils/powerbiService";
import CollectionHome from "./CollectionHome";

const mocks = vi.hoisted(() => ({
  workspace: null as Workspace | null,
  reload: vi.fn(),
  showToast: vi.fn(),
  toggleFavorite: vi.fn(),
}));

vi.mock("../context/WorkspaceContext", () => ({
  useWorkspace: () => ({ currentWorkspace: mocks.workspace, reload: mocks.reload }),
}));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
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
vi.mock("../components/EditCollectionModal", () => ({ default: () => null }));
vi.mock("../components/FullscreenReportView", () => ({
  default: ({ mode, reports, onExit }: { mode: string; reports: Report[]; onExit: () => void }) => (
    <div data-testid="fullscreen-section">
      <span>{`${mode}:${reports.length}`}</span>
      <button onClick={onExit}>sair da secao</button>
    </div>
  ),
}));

const listReports = vi.mocked(reportsApi.listReports);
const moveReport = vi.mocked(reportsApi.moveReport);
const updateWorkspace = vi.mocked(workspacesApi.updateWorkspace);
const recordCollectionView = vi.mocked(homeApi.recordCollectionView);
const getCollectionRefreshInfo = vi.mocked(reportsApi.getCollectionRefreshInfo);

// 8 relatorios: o campo de filtro so aparece a partir de 6
const REPORTS: Report[] = [
  makeReport(1, { name: "Vendas Mensal" }),
  makeReport(2, { name: "Vendas Anual" }),
  makeReport(3, { name: "Estoque Atual" }),
  makeReport(4, { name: "Painel Geral", display_type: "painel" }),
  makeReport(5, { name: "Apresentacao A", display_type: "apresentacao" }),
  makeReport(6, { name: "Apresentacao B", display_type: "apresentacao" }),
  makeReport(7, { name: "TV Loja 1", display_type: "tv" }),
  makeReport(8, { name: "TV Loja 2", display_type: "tv" }),
];

function comRole(role: Workspace["role"]) {
  mocks.workspace = makeWorkspace({ id: 3, name: "Colecao Vendas", role, tv_interval_seconds: 15 });
}

async function renderLoaded() {
  const utils = render(<CollectionHome />);
  await screen.findByRole("heading", { name: "Relatorios" });
  return utils;
}

function digitarFiltro(texto: string) {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: texto } });
}

beforeEach(() => {
  window.localStorage.clear();
  comRole("admin");
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
    const { container } = render(<CollectionHome />);

    expect(container.firstChild).toBeNull();
    expect(listReports).not.toHaveBeenCalled();
  });

  it("mostra o nome da colecao e uma secao por tipo de relatorio", async () => {
    await renderLoaded();

    expect(screen.getByRole("heading", { name: "Colecao Vendas" })).toBeTruthy();
    for (const titulo of ["Relatorios", "Painel", "Apresentacao", "Modo TV"]) {
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
    render(<CollectionHome />);

    expect(await screen.findByText("Nenhum relatorio nesta colecao ainda.")).toBeTruthy();
  });

  it("avisa com um toast quando a lista nao carrega", async () => {
    listReports.mockRejectedValue(new Error("rede"));
    render(<CollectionHome />);

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
    expect(screen.queryByRole("heading", { name: "Modo TV" })).toBeNull();
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
    rerender(<CollectionHome />);

    await waitFor(() => expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(""));
  });
});

describe("CollectionHome - reordenar", () => {
  it("quem so le nao ve os botoes de reordenar", async () => {
    comRole("viewer");
    await renderLoaded();

    expect(screen.queryByLabelText(/^Mover /)).toBeNull();
  });

  it("quem edita ve os botoes so na Apresentacao e no Modo TV, e o primeiro nao sobe", async () => {
    comRole("editor");
    await renderLoaded();

    expect(screen.getByLabelText("Mover Apresentacao A para baixo")).toBeTruthy();
    expect(screen.getByLabelText("Mover TV Loja 1 para baixo")).toBeTruthy();
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
    const reordenada = [REPORTS[0], REPORTS[1], REPORTS[2], REPORTS[3], REPORTS[5], REPORTS[4], REPORTS[6], REPORTS[7]];
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
  it("abre um relatorio em tela cheia ao clicar no card e sai com Esc", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText("Vendas Mensal").closest('[role="button"]') as HTMLElement);

    expect(screen.getByRole("button", { name: "Sair (Esc)" })).toBeTruthy();
    expect(screen.getByTestId("embed-1")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("button", { name: "Sair (Esc)" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Colecao Vendas" })).toBeTruthy();
  });

  it("o Modo TV usa a lista completa mesmo com a pagina filtrada", async () => {
    await renderLoaded();
    digitarFiltro("TV Loja 1");

    fireEvent.click(screen.getByRole("button", { name: /Abrir modo TV/ }));

    expect(screen.getByTestId("fullscreen-section").textContent).toContain("tv:2");
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

describe("CollectionHome - tempo do Modo TV", () => {
  it("so o administrador ve o campo de tempo", async () => {
    comRole("editor");
    await renderLoaded();

    expect(screen.queryByLabelText("Tempo (s)")).toBeNull();
  });

  it("grava o novo tempo ao sair do campo e recarrega a colecao", async () => {
    updateWorkspace.mockResolvedValue(makeWorkspace());
    await renderLoaded();
    const campo = screen.getByLabelText("Tempo (s)") as HTMLInputElement;
    expect(campo.value).toBe("15");

    fireEvent.change(campo, { target: { value: "30" } });
    fireEvent.blur(campo);

    await waitFor(() => expect(updateWorkspace).toHaveBeenCalledWith(3, { tv_interval_seconds: 30 }));
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
  });
});

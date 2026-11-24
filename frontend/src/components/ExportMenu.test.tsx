/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api/reportDelivery";
import { resetExportJobs } from "../utils/exportJobs";
import ExportMenu from "./ExportMenu";
import type { ReportEmbedHandle, TableVisualInfo } from "./ReportEmbed";

vi.mock("../api/reportDelivery", () => ({
  startReportDownload: vi.fn(),
  getDeliveryStatus: vi.fn(),
  downloadExportedFile: vi.fn(),
}));

const iniciar = vi.mocked(api.startReportDownload);
const status = vi.mocked(api.getDeliveryStatus);
const baixar = vi.mocked(api.downloadExportedFile);

const exportTableData = vi.fn();
const getTableVisuals = vi.fn();
const peekTableVisuals = vi.fn();
const getActivePageName = vi.fn();
const captureBookmarkState = vi.fn();

const TABELA_A: TableVisualInfo = { name: "v1", title: "Vendas por região" } as TableVisualInfo;
const TABELA_B: TableVisualInfo = { name: "v2", title: "Metas" } as TableVisualInfo;

function montar(canExportFile = true) {
  const embedRef = {
    current: {
      exportTableData,
      getTableVisuals,
      peekTableVisuals,
      getActivePageName,
      captureBookmarkState,
    } as unknown as ReportEmbedHandle,
  };
  return render(<ExportMenu embedRef={embedRef} workspaceId={3} reportId={34} canExportFile={canExportFile} />);
}

/** O botao Exportar do topo (muda o texto para "Exportando..." enquanto algo exporta) */
const botaoTopo = () => screen.getByRole("button", { name: /Export(ar|ando)/ });

/** Abre a lista de formatos pelo botao Exportar do topo */
async function abrirLista(canExportFile = true) {
  montar(canExportFile);
  fireEvent.click(botaoTopo());
  return screen.findByRole("menu", { name: "Exportar" });
}

/** Abre a lista e escolhe um formato, que abre a janela dele */
async function abrirJanela(formato: RegExp | string, canExportFile = true) {
  await abrirLista(canExportFile);
  fireEvent.click(screen.getByRole("menuitem", { name: formato }));
  return screen.findByRole("dialog");
}

/** O botao de confirmar da janela */
const confirmar = () => within(screen.getByRole("dialog")).getByRole("button", { name: "Exportar" });
/** A lista suspensa "Exportar com:" (valores atuais ou padrao) */
const valores = () => screen.getByRole("combobox", { name: /Exportar com/ }) as HTMLSelectElement;
const escolherValores = (valor: "current" | "default") => fireEvent.change(valores(), { target: { value: valor } });
const marcado = (nome: RegExp | string) => (screen.getByRole("checkbox", { name: nome }) as HTMLInputElement).checked;

beforeEach(() => {
  vi.resetAllMocks();
  resetExportJobs();
  peekTableVisuals.mockReturnValue([TABELA_A]);
  getTableVisuals.mockResolvedValue([TABELA_A]);
  getActivePageName.mockResolvedValue("ReportSection1");
  captureBookmarkState.mockResolvedValue("estado-abc");
  exportTableData.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ExportMenu - camadas da tela", () => {
  // O jsdom nao desenha camadas, entao estes testes leem o CSS: a lista abre solta no body e o botao fica na tela cheia
  // do relatorio (position fixed com z-index alto). Com z-index menor a lista abre escondida atras do relatorio.
  function zIndexDe(css: string, seletor: string): number {
    const bloco = new RegExp(`(?:^|\\n)${seletor.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css);
    const valor = /z-index:\s*(\d+)/.exec(bloco?.[1] ?? "");
    expect(valor, `z-index de ${seletor}`).not.toBeNull();
    return Number(valor![1]);
  }
  // O vitest esvazia o CSS importado com ?raw, entao le o arquivo direto (os testes rodam na pasta do frontend)
  const css = () => readFileSync(resolve(process.cwd(), "src/index.css"), "utf-8");

  it("a lista fica acima da tela cheia do relatorio", () => {
    expect(zIndexDe(css(), ".export-menu")).toBeGreaterThan(zIndexDe(css(), ".fullscreen-view"));
  });

  it("a janela do formato fica acima da lista e da tela cheia", () => {
    expect(zIndexDe(css(), ".export-dialog-overlay")).toBeGreaterThan(zIndexDe(css(), ".export-menu"));
    expect(zIndexDe(css(), ".export-dialog-overlay")).toBeGreaterThan(zIndexDe(css(), ".fullscreen-view"));
  });

  it("os avisos de exportacao ficam acima de tudo, inclusive da janela do formato", () => {
    expect(zIndexDe(css(), ".export-tray")).toBeGreaterThan(zIndexDe(css(), ".export-dialog-overlay"));
  });
});

describe("ExportMenu - a lista de formatos", () => {
  it("o botao abre a lista: Excel, PowerPoint, PDF e imagem, cada um com o seu logo", async () => {
    const lista = await abrirLista();

    // O nome e o texto depois do logo (o logo do PDF tem a sigla desenhada dentro)
    const nomes = within(lista)
      .getAllByRole("menuitem")
      .map((item) => item.lastChild?.textContent);
    expect(nomes).toEqual(["Excel", "PowerPoint", "PDF", "Imagem (PNG)"]);
    expect(lista.querySelectorAll("svg.export-format-icon")).toHaveLength(4);
  });

  it("nao oferece CSV", async () => {
    await abrirLista();

    expect(screen.queryByText(/CSV/)).toBeNull();
  });

  it("sem permissao de exportar, so o Excel aparece", async () => {
    const lista = await abrirLista(false);

    expect(within(lista).getAllByRole("menuitem").map((item) => item.lastChild?.textContent)).toEqual(["Excel"]);
  });

  it("Esc fecha a lista", async () => {
    await abrirLista();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clicar fora fecha a lista", async () => {
    await abrirLista();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clicar no botao de novo fecha a lista", async () => {
    await abrirLista();

    fireEvent.click(botaoTopo());

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("escolher um formato fecha a lista e abre a janela dele", async () => {
    await abrirJanela("PDF");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Exportar para PDF" })).toBeTruthy();
  });
});

describe("ExportMenu - Excel das tabelas", () => {
  it("a janela do Excel tem o titulo com o logo", async () => {
    const janela = await abrirJanela("Excel");

    expect(janela.getAttribute("aria-label")).toBe("Exportar para o Excel");
    expect(janela.querySelector("svg.export-format-icon")).not.toBeNull();
  });

  it("uma tabela so: exporta em Excel e a janela fecha na hora", async () => {
    await abrirJanela("Excel");

    fireEvent.click(confirmar());

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(exportTableData).toHaveBeenCalledWith("v1", "xlsx"));
  });

  it("varias tabelas: escolhe qual ou todas", async () => {
    peekTableVisuals.mockReturnValue([TABELA_A, TABELA_B]);
    await abrirJanela("Excel");

    expect(screen.getByRole("option", { name: "Todas as tabelas (2)" })).toBeTruthy();
    fireEvent.click(confirmar());
    await waitFor(() => expect(exportTableData).toHaveBeenLastCalledWith(undefined, "xlsx"));

    fireEvent.click(botaoTopo());
    fireEvent.click(await screen.findByRole("menuitem", { name: "Excel" }));
    fireEvent.change(await screen.findByRole("combobox", { name: /Qual tabela/ }), { target: { value: "v2" } });
    fireEvent.click(confirmar());
    await waitFor(() => expect(exportTableData).toHaveBeenLastCalledWith("v2", "xlsx"));
  });

  it("pagina sem tabelas: avisa e nao deixa exportar", async () => {
    peekTableVisuals.mockReturnValue([]);
    await abrirJanela("Excel");

    expect(screen.getByText("Nenhuma tabela encontrada na página atual.")).toBeTruthy();
    expect((confirmar() as HTMLButtonElement).disabled).toBe(true);
  });

  it("erro ao exportar as tabelas aparece no aviso do canto da tela, com a janela ja fechada", async () => {
    exportTableData.mockRejectedValue(new Error("Nao foi possivel exportar os dados."));
    await abrirJanela("Excel");

    fireEvent.click(confirmar());

    expect((await screen.findByRole("alert")).textContent).toContain("Nao foi possivel exportar os dados.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cancelar, o X e Esc fecham a janela", async () => {
    await abrirJanela("Excel");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(botaoTopo());
    fireEvent.click(await screen.findByRole("menuitem", { name: "Excel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(botaoTopo());
    fireEvent.click(await screen.findByRole("menuitem", { name: "Excel" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ExportMenu - as tabelas ja lidas", () => {
  it("com as tabelas ja lidas, a janela do Excel abre pronta, sem procurar", async () => {
    peekTableVisuals.mockReturnValue([TABELA_A, TABELA_B]);
    await abrirJanela("Excel");

    expect(screen.queryByText("Procurando tabelas na página...")).toBeNull();
    expect(screen.getByRole("combobox", { name: /Qual tabela/ })).toBeTruthy();
    expect((confirmar() as HTMLButtonElement).disabled).toBe(false);
    expect(getTableVisuals).not.toHaveBeenCalled();
  });

  it("sem leitura pronta, procura ao abrir a lista e mostra o aviso enquanto isso", async () => {
    peekTableVisuals.mockReturnValue(null);
    let liberar: (lista: TableVisualInfo[]) => void = () => {};
    getTableVisuals.mockReturnValue(new Promise((resolve) => (liberar = resolve)));
    await abrirJanela("Excel");

    expect(screen.getByText("Procurando tabelas na página...")).toBeTruthy();
    expect((confirmar() as HTMLButtonElement).disabled).toBe(true);
    await act(async () => liberar([TABELA_A]));

    expect(screen.queryByText("Procurando tabelas na página...")).toBeNull();
    expect((confirmar() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("ExportMenu - a janela de PDF, PowerPoint e imagem", () => {
  it("abre com Valores Atuais na lista e a caixa da pagina atual desmarcada, como no Power BI", async () => {
    await abrirJanela("PDF");

    expect(valores().value).toBe("current");
    expect(within(valores()).getAllByRole("option").map((o) => o.textContent)).toEqual(["Valores Atuais", "Valores Padrão"]);
    expect(marcado("Exportar somente a página atual")).toBe(false);
  });

  it("o PowerPoint mostra o logo no titulo e explica que cada pagina vira um slide, sem lista travada", async () => {
    const janela = await abrirJanela("PowerPoint");

    expect(janela.getAttribute("aria-label")).toBe("Exportar para o PowerPoint");
    expect(janela.querySelector("svg.export-format-icon")).not.toBeNull();
    expect(screen.getByText("Cada página do relatório vira um slide, com a imagem da página.")).toBeTruthy();
    // A unica lista suspensa e a de valores atuais ou padrao: nada de lista travada para escolher o jeito de exportar
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByText(/Escolha como exportar/)).toBeNull();
  });

  it("a imagem tem o titulo proprio", async () => {
    const janela = await abrirJanela("Imagem (PNG)");

    expect(janela.getAttribute("aria-label")).toBe("Exportar como imagem");
  });

  it("nao tem a opcao de excluir guias ocultas", async () => {
    await abrirJanela("PDF");

    expect(screen.queryByText(/guias ocultas/)).toBeNull();
  });

  it("cada vez que a janela abre, as opcoes voltam ao padrao", async () => {
    await abrirJanela("PDF");
    escolherValores("default");
    fireEvent.click(screen.getByRole("checkbox", { name: "Exportar somente a página atual" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    fireEvent.click(botaoTopo());
    fireEvent.click(await screen.findByRole("menuitem", { name: "PDF" }));
    await screen.findByRole("dialog");

    expect(valores().value).toBe("current");
    expect(marcado("Exportar somente a página atual")).toBe(false);
  });
});

describe("ExportMenu - gerar o arquivo em segundo plano", () => {
  async function exportar(formato: RegExp | string, ajustar?: () => void) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await abrirJanela(formato);
    ajustar?.();
    fireEvent.click(confirmar());
  }
  const avancar = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const PRONTO = { status: "done" as const, message: "Arquivo pronto.", progress: 100 };

  it("a janela fecha na hora e o aviso animado mostra que esta exportando", async () => {
    iniciar.mockResolvedValue("job-0");
    status.mockResolvedValue({ status: "exporting", message: "Exportando o relatorio no Power BI...", progress: 0 });

    await exportar("PDF");

    expect(screen.queryByRole("dialog")).toBeNull();
    const aviso = await screen.findByRole("status");
    expect(aviso.textContent).toContain("Exportando PDF...");
    expect(aviso.querySelector(".export-spinner")).not.toBeNull();
    expect(aviso.querySelector(".export-tray-bar-wait")).not.toBeNull();
    // O botao do topo tambem gira e muda o texto
    expect(botaoTopo().textContent).toContain("Exportando...");
    expect(botaoTopo().querySelector(".export-spinner")).not.toBeNull();
  });

  it("mostra a porcentagem quando o Power BI informa", async () => {
    iniciar.mockResolvedValue("job-p");
    status.mockResolvedValue({ status: "exporting", message: "Exportando o relatorio no Power BI...", progress: 45 });

    await exportar("PDF");
    await avancar(600);

    const aviso = await screen.findByRole("status");
    await waitFor(() => expect((aviso.querySelector(".export-tray-bar-fill") as HTMLElement).style.width).toBe("45%"));
  });

  it("relatorio inteiro em PDF, com os valores atuais: captura o estado, pede, acompanha e baixa", async () => {
    iniciar.mockResolvedValue("job-1");
    status
      .mockResolvedValueOnce({ status: "exporting", message: "Exportando o relatorio no Power BI...", progress: 20 })
      .mockResolvedValue({ ...PRONTO, file_name: "Vendas.pdf" });
    baixar.mockResolvedValue(undefined);

    await exportar("PDF");
    await waitFor(() => expect(iniciar).toHaveBeenCalledWith(3, 34, "PDF", null, "estado-abc"));
    await avancar(600);
    expect((await screen.findByRole("status")).textContent).toContain("Exportando o relatorio no Power BI...");
    await avancar(1100);

    await waitFor(() => expect(baixar).toHaveBeenCalledWith(3, "job-1", "Vendas.pdf"));
    expect(getActivePageName).not.toHaveBeenCalled();
  });

  it("a primeira consulta do andamento sai em meio segundo, sem esperar mais", async () => {
    iniciar.mockResolvedValue("job-rapido");
    status.mockResolvedValue({ ...PRONTO, file_name: "Vendas.pdf" });
    baixar.mockResolvedValue(undefined);

    await exportar("PDF");
    await waitFor(() => expect(iniciar).toHaveBeenCalled());
    expect(status).not.toHaveBeenCalled();
    await avancar(550);

    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(baixar).toHaveBeenCalledWith(3, "job-rapido", "Vendas.pdf"));
  });

  it("ao terminar mostra que esta pronto e o aviso some sozinho", async () => {
    iniciar.mockResolvedValue("job-2");
    status.mockResolvedValue({ ...PRONTO, file_name: "Vendas.pdf" });
    baixar.mockResolvedValue(undefined);

    await exportar("PDF");
    await avancar(600);

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Pronto"));
    expect(botaoTopo().textContent).toContain("Exportar");
    expect(botaoTopo().textContent).not.toContain("Exportando");
    await avancar(4100);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Valores Padrao: nao captura o estado do relatorio", async () => {
    iniciar.mockResolvedValue("job-3");
    status.mockResolvedValue({ ...PRONTO, file_name: "Vendas.pdf" });
    baixar.mockResolvedValue(undefined);

    await exportar("PDF", () => escolherValores("default"));

    await waitFor(() => expect(iniciar).toHaveBeenCalledWith(3, 34, "PDF", null, null));
    expect(captureBookmarkState).not.toHaveBeenCalled();
  });

  it("se nao der para capturar o estado, exporta com os valores padrao", async () => {
    captureBookmarkState.mockResolvedValue(null);
    iniciar.mockResolvedValue("job-4");
    status.mockResolvedValue({ ...PRONTO, file_name: "Vendas.pdf" });
    baixar.mockResolvedValue(undefined);

    await exportar("PDF");

    await waitFor(() => expect(iniciar).toHaveBeenCalledWith(3, 34, "PDF", null, null));
  });

  it("somente a pagina atual: pede com o nome da pagina", async () => {
    iniciar.mockResolvedValue("job-5");
    status.mockResolvedValue({ ...PRONTO, file_name: "Resumo.pdf" });
    baixar.mockResolvedValue(undefined);

    await exportar("PDF", () => fireEvent.click(screen.getByRole("checkbox", { name: "Exportar somente a página atual" })));

    await waitFor(() => expect(iniciar).toHaveBeenCalledWith(3, 34, "PDF", "ReportSection1", "estado-abc"));
  });

  it("PowerPoint: pede PPTX e baixa o arquivo", async () => {
    iniciar.mockResolvedValue("job-6");
    status.mockResolvedValue({ ...PRONTO, file_name: "Vendas.pptx" });
    baixar.mockResolvedValue(undefined);

    await exportar("PowerPoint");
    await waitFor(() => expect(iniciar).toHaveBeenCalledWith(3, 34, "PPTX", null, "estado-abc"));
    await avancar(600);

    await waitFor(() => expect(baixar).toHaveBeenCalledWith(3, "job-6", "Vendas.pptx"));
  });

  it("sem nome no status, o arquivo sai com a extensao do formato", async () => {
    iniciar.mockResolvedValue("job-7");
    status.mockResolvedValue(PRONTO);
    baixar.mockResolvedValue(undefined);

    await exportar("PowerPoint");
    await avancar(600);

    await waitFor(() => expect(baixar).toHaveBeenCalledWith(3, "job-7", "relatorio.pptx"));
  });

  it("imagem: pede PNG", async () => {
    iniciar.mockResolvedValue("job-8");
    status.mockResolvedValue({ ...PRONTO, file_name: "Vendas.zip" });
    baixar.mockResolvedValue(undefined);

    await exportar("Imagem (PNG)");
    await waitFor(() => expect(iniciar).toHaveBeenCalledWith(3, 34, "PNG", null, "estado-abc"));
    await avancar(600);

    await waitFor(() => expect(baixar).toHaveBeenCalledWith(3, "job-8", "Vendas.zip"));
  });

  it("falha na exportacao fica no aviso com o motivo, nao baixa nada e pode ser fechada", async () => {
    iniciar.mockResolvedValue("job-9");
    status.mockResolvedValue({ status: "error", message: "capacidade sem suporte", progress: 0 });

    await exportar("PDF");
    await avancar(600);

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("capacidade sem suporte");
    expect(baixar).not.toHaveBeenCalled();
    expect(botaoTopo().textContent).toContain("Exportar");

    fireEvent.click(within(alerta).getByRole("button", { name: "Fechar aviso" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("pedido recusado pelo servidor (ex.: relatorio com RLS) mostra o motivo no aviso", async () => {
    iniciar.mockRejectedValue({ response: { data: { detail: "Relatorios com seguranca por linha (RLS) ainda nao podem ser exportados." } } });

    await exportar("PDF");

    expect((await screen.findByRole("alert")).textContent).toContain("RLS");
  });

  it("pagina que nao da para identificar nao chega a pedir a exportacao", async () => {
    getActivePageName.mockResolvedValue(null);

    await exportar("PDF", () => fireEvent.click(screen.getByRole("checkbox", { name: "Exportar somente a página atual" })));

    expect((await screen.findByRole("alert")).textContent).toContain("identificar a pagina");
    expect(iniciar).not.toHaveBeenCalled();
  });

  it("da para abrir o Exportar de novo e pedir outro formato enquanto o primeiro roda", async () => {
    iniciar.mockResolvedValue("job-a");
    status.mockResolvedValue({ status: "exporting", message: "Exportando...", progress: 10 });
    await exportar("PDF");
    await waitFor(() => expect(iniciar).toHaveBeenCalledTimes(1));

    fireEvent.click(botaoTopo());
    fireEvent.click(await screen.findByRole("menuitem", { name: "Imagem (PNG)" }));
    await screen.findByRole("dialog");
    fireEvent.click(confirmar());

    await waitFor(() => expect(iniciar).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole("status")).toHaveLength(2);
  });

  it("clicar no fundo escuro fecha a janela", async () => {
    await abrirJanela("PDF");

    fireEvent.mouseDown(document.querySelector(".export-dialog-overlay") as HTMLElement);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a exportacao continua e baixa mesmo se a pessoa sair do relatorio", async () => {
    iniciar.mockResolvedValue("job-sair");
    status.mockResolvedValue({ ...PRONTO, file_name: "Vendas.pdf" });
    baixar.mockResolvedValue(undefined);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = montar();
    fireEvent.click(botaoTopo());
    fireEvent.click(await screen.findByRole("menuitem", { name: "PDF" }));
    await screen.findByRole("dialog");
    fireEvent.click(confirmar());
    await waitFor(() => expect(iniciar).toHaveBeenCalled());

    unmount();
    await avancar(600);

    await waitFor(() => expect(baixar).toHaveBeenCalledWith(3, "job-sair", "Vendas.pdf"));
  });
});

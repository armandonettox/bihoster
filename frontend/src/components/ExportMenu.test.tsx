import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api/reportDelivery";
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
const getActivePageName = vi.fn();

const TABELA_A: TableVisualInfo = { name: "v1", title: "Vendas por região" } as TableVisualInfo;
const TABELA_B: TableVisualInfo = { name: "v2", title: "Metas" } as TableVisualInfo;

function montar(canExportFile = true) {
  const embedRef = { current: { exportTableData, getTableVisuals, getActivePageName } as unknown as ReportEmbedHandle };
  return render(<ExportMenu embedRef={embedRef} workspaceId={3} reportId={34} canExportFile={canExportFile} />);
}

async function abrir(canExportFile = true) {
  montar(canExportFile);
  fireEvent.click(screen.getByRole("button", { name: /Exportar/ }));
  return screen.findByRole("dialog", { name: "Exportar" });
}

/** O botao de confirmar da janela (o do topo tem o mesmo nome) */
const confirmar = () => within(screen.getByRole("dialog")).getByRole("button", { name: "Exportar" });
const radio = (nome: RegExp | string) => screen.getByRole("radio", { name: nome });

beforeEach(() => {
  vi.resetAllMocks();
  getTableVisuals.mockResolvedValue([TABELA_A]);
  getActivePageName.mockResolvedValue("ReportSection1");
  exportTableData.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ExportMenu - a janela", () => {
  it("o botao abre uma janela com o que exportar e como", async () => {
    await abrir();

    expect(radio(/Tabelas da página/)).toBeTruthy();
    expect(radio(/Página atual/)).toBeTruthy();
    expect(radio(/Relatório inteiro/)).toBeTruthy();
    expect(radio(/CSV/)).toBeTruthy();
    expect(radio(/Excel/)).toBeTruthy();
  });

  it("sem permissao de exportar, so as tabelas aparecem", async () => {
    await abrir(false);

    expect(radio(/Tabelas da página/)).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Página atual/ })).toBeNull();
    expect(screen.queryByRole("radio", { name: /Relatório inteiro/ })).toBeNull();
  });

  it("trocar o que exportar troca os formatos: PDF e imagem para pagina e relatorio", async () => {
    await abrir();

    fireEvent.click(radio(/Página atual/));

    expect(radio(/PDF/)).toBeTruthy();
    expect(radio(/Imagem \(PNG\)/)).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Excel/ })).toBeNull();
    expect((radio(/PDF/) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(radio(/Tabelas da página/));

    expect((radio(/CSV/) as HTMLInputElement).checked).toBe(true);
  });

  it("Cancelar e Esc fecham a janela", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Exportar/ }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicar fora fecha a janela", async () => {
    await abrir();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ExportMenu - tabelas", () => {
  it("uma tabela so: exporta direto em CSV", async () => {
    await abrir();
    await waitFor(() => expect(getTableVisuals).toHaveBeenCalled());

    fireEvent.click(confirmar());

    await waitFor(() => expect(exportTableData).toHaveBeenCalledWith("v1", "csv"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("escolhendo Excel, pede a planilha", async () => {
    await abrir();
    await waitFor(() => expect(getTableVisuals).toHaveBeenCalled());

    fireEvent.click(radio(/Excel/));
    fireEvent.click(confirmar());

    await waitFor(() => expect(exportTableData).toHaveBeenCalledWith("v1", "xlsx"));
  });

  it("varias tabelas: escolhe qual ou todas", async () => {
    getTableVisuals.mockResolvedValue([TABELA_A, TABELA_B]);
    await abrir();
    const seletor = await screen.findByRole("combobox", { name: /Qual tabela/ });

    expect(screen.getByRole("option", { name: "Todas as tabelas (2)" })).toBeTruthy();
    fireEvent.click(radio(/Excel/));
    fireEvent.click(confirmar());
    await waitFor(() => expect(exportTableData).toHaveBeenLastCalledWith(undefined, "xlsx"));

    fireEvent.click(screen.getByRole("button", { name: /Exportar/ }));
    fireEvent.change(await screen.findByRole("combobox", { name: /Qual tabela/ }), { target: { value: "v2" } });
    fireEvent.click(confirmar());
    await waitFor(() => expect(exportTableData).toHaveBeenLastCalledWith("v2", "csv"));
    expect(seletor).toBeTruthy();
  });

  it("pagina sem tabelas: avisa e, podendo exportar arquivo, passa para a pagina em PDF", async () => {
    getTableVisuals.mockResolvedValue([]);
    await abrir();

    await waitFor(() => expect((radio(/Página atual/) as HTMLInputElement).checked).toBe(true));
    expect((radio(/PDF/) as HTMLInputElement).checked).toBe(true);
  });

  it("pagina sem tabelas e sem permissao de arquivo: mostra o aviso e nao deixa exportar", async () => {
    getTableVisuals.mockResolvedValue([]);
    await abrir(false);

    expect(await screen.findByText("Nenhuma tabela encontrada na página atual.")).toBeTruthy();
    expect((confirmar() as HTMLButtonElement).disabled).toBe(true);
  });

  it("erro ao exportar as tabelas aparece na janela e ela continua aberta", async () => {
    exportTableData.mockRejectedValue(new Error("Nao foi possivel exportar os dados."));
    await abrir();
    await waitFor(() => expect(getTableVisuals).toHaveBeenCalled());

    fireEvent.click(confirmar());

    expect((await screen.findByRole("alert")).textContent).toBe("Nao foi possivel exportar os dados.");
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});

describe("ExportMenu - PDF e imagem", () => {
  async function exportar(escopo: RegExp, formato?: RegExp) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await abrir();
    await waitFor(() => expect(getTableVisuals).toHaveBeenCalled());
    fireEvent.click(radio(escopo));
    if (formato) fireEvent.click(radio(formato));
    fireEvent.click(confirmar());
  }

  it("pagina atual em PDF: pede com o nome da pagina, acompanha e baixa com o nome do arquivo", async () => {
    iniciar.mockResolvedValue("job-1");
    status
      .mockResolvedValueOnce({ status: "exporting", message: "Exportando o relatorio no Power BI...", progress: 20 })
      .mockResolvedValueOnce({ status: "done", message: "Arquivo pronto.", progress: 100, file_name: "Resumo.pdf" });
    baixar.mockResolvedValue(undefined);

    await exportar(/Página atual/);
    await waitFor(() => expect(iniciar).toHaveBeenCalledWith(3, 34, "PDF", "ReportSection1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.getByRole("status").textContent).toBe("Exportando o relatorio no Power BI...");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    await waitFor(() => expect(baixar).toHaveBeenCalledWith(3, "job-1", "Resumo.pdf"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("relatorio inteiro em imagem: pede sem pagina", async () => {
    iniciar.mockResolvedValue("job-2");
    status.mockResolvedValue({ status: "done", message: "Arquivo pronto.", progress: 100, file_name: "Vendas.zip" });
    baixar.mockResolvedValue(undefined);

    await exportar(/Relatório inteiro/, /Imagem \(PNG\)/);
    await waitFor(() => expect(iniciar).toHaveBeenCalledWith(3, 34, "PNG", null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    await waitFor(() => expect(baixar).toHaveBeenCalledWith(3, "job-2", "Vendas.zip"));
    expect(getActivePageName).not.toHaveBeenCalled();
  });

  it("falha na exportacao mostra a mensagem do servidor e nao baixa nada", async () => {
    iniciar.mockResolvedValue("job-3");
    status.mockResolvedValue({ status: "error", message: "capacidade sem suporte", progress: 0 });

    await exportar(/Relatório inteiro/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    expect((await screen.findByRole("alert")).textContent).toBe("capacidade sem suporte");
    expect(baixar).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("pedido recusado pelo servidor (ex.: relatorio com RLS) mostra o motivo", async () => {
    iniciar.mockRejectedValue({ response: { data: { detail: "Relatorios com seguranca por linha (RLS) ainda nao podem ser exportados." } } });

    await exportar(/Relatório inteiro/);

    expect((await screen.findByRole("alert")).textContent).toContain("RLS");
  });

  it("pagina que nao da para identificar nao chega a pedir a exportacao", async () => {
    getActivePageName.mockResolvedValue(null);

    await exportar(/Página atual/);

    expect((await screen.findByRole("alert")).textContent).toContain("identificar a pagina");
    expect(iniciar).not.toHaveBeenCalled();
  });

  it("enquanto exporta, a janela nao fecha por Esc nem por clique fora", async () => {
    iniciar.mockResolvedValue("job-4");
    status.mockResolvedValue({ status: "exporting", message: "Exportando...", progress: 10 });

    await exportar(/Relatório inteiro/);
    await waitFor(() => expect(iniciar).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Exportando..." }) as HTMLButtonElement).disabled).toBe(true);
  });
});

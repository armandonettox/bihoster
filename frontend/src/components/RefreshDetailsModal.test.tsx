import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as reportsApi from "../api/reports";
import type { RefreshInfo } from "../api/reports";
import { deferred, makeReport } from "../test-fixtures";
import { statusLabel } from "../utils/refreshStatus";
import RefreshDetailsModal from "./RefreshDetailsModal";

vi.mock("../api/reports", () => ({ getCollectionRefreshInfo: vi.fn() }));

const getInfo = vi.mocked(reportsApi.getCollectionRefreshInfo);

const REPORTS = [
  makeReport(1, { name: "Vendas" }),
  makeReport(2, { name: "Estoque", display_type: "painel" }),
  makeReport(3, { name: "Financeiro", display_type: "tv" }),
  makeReport(4, { name: "Sem dataset" }),
];

const INFO: Record<string, RefreshInfo> = {
  "1": { last_refresh: "2026-11-04T10:00:00Z", next_refresh: "2026-11-05T10:00:00Z", last_status: "Completed" },
  "2": { last_refresh: "2026-11-01T10:00:00Z", next_refresh: null, last_status: "Failed" },
  "3": { last_refresh: "2026-11-03T10:00:00Z", next_refresh: "2026-11-04T22:00:00Z", last_status: "Completed" },
  // relatorio 4: sem dataset, o backend manda tudo vazio
  "4": { last_refresh: null, next_refresh: null, last_status: null },
};

function nomesNaOrdem(): string[] {
  const linhas = screen.getAllByRole("row").slice(1); // sem o cabecalho
  return linhas.map((linha) => within(linha).getAllByRole("cell")[0].textContent ?? "");
}

function renderModal(onClose = vi.fn()) {
  render(<RefreshDetailsModal reports={REPORTS} workspaceId={7} onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  getInfo.mockResolvedValue(INFO);
});

describe("statusLabel", () => {
  it.each([
    ["Completed", "Concluida"],
    ["Failed", "Falhou"],
    ["Unknown", "Em andamento"],
    ["Disabled", "Desabilitada"],
    ["Cancelled", "Cancelada"],
    [null, "-"],
    [undefined, "-"],
    ["", "-"],
    ["AlgoNovo", "AlgoNovo"],
  ])("traduz %j para %s", (entrada, esperado) => {
    expect(statusLabel(entrada)).toBe(esperado);
  });
});

describe("RefreshDetailsModal", () => {
  it("busca as informacoes da colecao uma vez, so ao abrir", async () => {
    renderModal();

    await screen.findByRole("table");

    expect(getInfo).toHaveBeenCalledTimes(1);
    expect(getInfo).toHaveBeenCalledWith(7);
  });

  it("mostra uma linha por relatorio com tipo, status e datas", async () => {
    renderModal();
    await screen.findByRole("table");

    const linha = screen.getByText("Estoque").closest("tr") as HTMLElement;
    const celulas = within(linha).getAllByRole("cell").map((c) => c.textContent);
    expect(celulas[1]).toBe("Painel");
    expect(celulas[2]).toBe("Falhou");
    expect(celulas[3]).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(celulas[4]).toBe("-"); // sem proxima atualizacao agendada
    expect(screen.getAllByRole("row")).toHaveLength(REPORTS.length + 1);
  });

  it("relatorio sem dataset aparece com tracos em tudo", async () => {
    renderModal();
    await screen.findByRole("table");

    const linha = screen.getByText("Sem dataset").closest("tr") as HTMLElement;
    const celulas = within(linha).getAllByRole("cell").map((c) => c.textContent);
    expect(celulas.slice(2)).toEqual(["-", "-", "-"]);
  });

  it("comeca pela atualizacao mais antiga e deixa quem nao tem data no fim", async () => {
    renderModal();
    await screen.findByRole("table");

    expect(nomesNaOrdem()).toEqual(["Estoque", "Financeiro", "Vendas", "Sem dataset"]);
  });

  it("clicar na coluna inverte a ordem, e quem nao tem data continua no fim", async () => {
    renderModal();
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: /Ultima atualizacao/ }));

    expect(nomesNaOrdem()).toEqual(["Vendas", "Financeiro", "Estoque", "Sem dataset"]);
  });

  it("ordena por nome ao clicar na coluna Relatorio", async () => {
    renderModal();
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: /^Relatorio/ }));

    expect(nomesNaOrdem()).toEqual(["Estoque", "Financeiro", "Sem dataset", "Vendas"]);
    expect(screen.getByRole("columnheader", { name: /Relatorio/ }).getAttribute("aria-sort")).toBe("ascending");
  });

  it("mostra o carregando enquanto a resposta nao chega", async () => {
    const resposta = deferred<Record<string, RefreshInfo>>();
    getInfo.mockReturnValue(resposta.promise);
    renderModal();

    expect(screen.queryByRole("table")).toBeNull();

    resposta.resolve(INFO);
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("avisa quando falha e deixa tentar de novo", async () => {
    getInfo.mockRejectedValueOnce(new Error("502"));
    renderModal();

    expect(await screen.findByText(/Nao foi possivel carregar/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByRole("table")).toBeTruthy();
    expect(getInfo).toHaveBeenCalledTimes(2);
  });

  it("colecao sem relatorios mostra o aviso e nao chama o resumo como tabela", async () => {
    render(<RefreshDetailsModal reports={[]} workspaceId={7} onClose={vi.fn()} />);

    expect(screen.getByText("Nenhum relatorio nesta colecao ainda.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("fecha pelo botao de fechar", async () => {
    const onClose = renderModal();
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

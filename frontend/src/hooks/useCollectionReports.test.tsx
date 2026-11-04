import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as reportsApi from "../api/reports";
import type { Report } from "../api/reports";
import { deferred, makeReport } from "../test-fixtures";
import { useCollectionReports } from "./useCollectionReports";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../api/reports", () => ({ listReports: vi.fn(), deleteReport: vi.fn(), moveReport: vi.fn() }));

const listReports = vi.mocked(reportsApi.listReports);
const deleteReport = vi.mocked(reportsApi.deleteReport);
const moveReport = vi.mocked(reportsApi.moveReport);

const r1 = makeReport(1);
const r2 = makeReport(2);

function renderWithId(initialId: number | undefined) {
  return renderHook(({ id }: { id: number | undefined }) => useCollectionReports(id), {
    initialProps: { id: initialId },
  });
}

// Colecao 7 por padrao. Um parametro com valor padrao nao serve pro caso "sem colecao", porque
// passar undefined cairia no padrao -- por isso o caso sem colecao usa renderWithId direto.
function setup(initialId = 7) {
  return renderWithId(initialId);
}

async function setupLoaded() {
  const utils = setup();
  await waitFor(() => expect(utils.result.current.loading).toBe(false));
  return utils;
}

beforeEach(() => {
  mocks.showToast.mockClear();
  listReports.mockResolvedValue([r1, r2]);
  deleteReport.mockResolvedValue(undefined);
});

describe("useCollectionReports - carga", () => {
  it("carrega os relatorios da colecao ao montar", async () => {
    const { result } = setup(7);
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listReports).toHaveBeenCalledWith(7);
    expect(result.current.reports).toEqual([r1, r2]);
  });

  it("avisa e termina o carregamento quando a carga falha", async () => {
    listReports.mockRejectedValue(new Error("rede"));
    const { result } = setup();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mocks.showToast).toHaveBeenCalledWith("Nao foi possivel carregar os relatorios desta colecao.", "error");
    expect(result.current.reports).toEqual([]);
  });

  it("ignora a resposta atrasada de uma colecao antiga ao trocar de colecao", async () => {
    const antiga = deferred<Report[]>();
    const nova = deferred<Report[]>();
    listReports.mockReturnValueOnce(antiga.promise).mockReturnValueOnce(nova.promise);
    const { result, rerender } = setup(1);

    rerender({ id: 2 });
    await act(async () => {
      nova.resolve([makeReport(20, { name: "Da colecao nova" })]);
    });
    await waitFor(() => expect(result.current.reports.map((r) => r.id)).toEqual([20]));

    // A resposta da colecao antiga chega depois e nao pode sobrescrever a nova
    await act(async () => {
      antiga.resolve([makeReport(10, { name: "Da colecao antiga" })]);
    });
    expect(result.current.reports.map((r) => r.id)).toEqual([20]);
  });

  it("nao chama a API quando ainda nao ha colecao selecionada", async () => {
    const { result } = renderWithId(undefined);

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.deleteReport(1);
      await result.current.moveReport(r1, "down");
    });

    expect(listReports).not.toHaveBeenCalled();
    expect(deleteReport).not.toHaveBeenCalled();
    expect(moveReport).not.toHaveBeenCalled();
  });
});

describe("useCollectionReports - excluir", () => {
  it("tira da lista na hora, avisa e recarrega em segundo plano", async () => {
    listReports.mockResolvedValueOnce([r1, r2]).mockResolvedValueOnce([r2]);
    const { result } = await setupLoaded();

    await act(async () => {
      await result.current.deleteReport(1);
    });

    expect(deleteReport).toHaveBeenCalledWith(7, 1);
    expect(result.current.reports.map((r) => r.id)).toEqual([2]);
    expect(mocks.showToast).toHaveBeenCalledWith("Relatorio excluido.");
    await waitFor(() => expect(listReports).toHaveBeenCalledTimes(2));
  });

  it("mantem a lista e mostra o erro quando a exclusao falha", async () => {
    deleteReport.mockRejectedValue(new Error("403"));
    const { result } = await setupLoaded();

    await act(async () => {
      await result.current.deleteReport(1);
    });

    expect(result.current.reports.map((r) => r.id)).toEqual([1, 2]);
    expect(mocks.showToast).toHaveBeenCalledWith("Nao foi possivel excluir o relatorio.", "error");
    expect(listReports).toHaveBeenCalledTimes(1);
  });

  it("excluir o relatorio expandido deixa nenhum expandido", async () => {
    listReports.mockResolvedValueOnce([r1, r2]).mockResolvedValueOnce([r2]);
    const { result } = await setupLoaded();
    act(() => result.current.toggleActiveReport(1));
    expect(result.current.activeReportId).toBe(1);

    await act(async () => {
      await result.current.deleteReport(1);
    });

    expect(result.current.activeReportId).toBeNull();
  });
});

describe("useCollectionReports - expandir", () => {
  it("expande um relatorio e fecha ao clicar de novo", async () => {
    const { result } = await setupLoaded();

    act(() => result.current.toggleActiveReport(1));
    expect(result.current.activeReportId).toBe(1);

    act(() => result.current.toggleActiveReport(1));
    expect(result.current.activeReportId).toBeNull();
  });

  it("so um relatorio fica expandido: abrir outro fecha o anterior", async () => {
    const { result } = await setupLoaded();

    act(() => result.current.toggleActiveReport(1));
    act(() => result.current.toggleActiveReport(2));

    expect(result.current.activeReportId).toBe(2);
  });

  it("trocar de colecao fecha o que estava expandido", async () => {
    const { result, rerender } = await setupLoaded();
    act(() => result.current.toggleActiveReport(1));

    listReports.mockResolvedValue([]);
    rerender({ id: 8 });
    await waitFor(() => expect(result.current.reports).toEqual([]));

    expect(result.current.activeReportId).toBeNull();
  });
});

describe("useCollectionReports - reordenar", () => {
  it("usa a ordem devolvida pelo servidor e bloqueia um segundo movimento enquanto o primeiro roda", async () => {
    const { result } = await setupLoaded();
    const resposta = deferred<Report[]>();
    moveReport.mockReturnValue(resposta.promise);

    act(() => {
      void result.current.moveReport(r1, "down");
    });
    expect(result.current.movingReportId).toBe(1);

    // Segundo clique enquanto o primeiro ainda nao voltou: nao pode mandar outro pedido
    act(() => {
      void result.current.moveReport(r2, "up");
    });
    expect(moveReport).toHaveBeenCalledTimes(1);
    expect(moveReport).toHaveBeenCalledWith(7, 1, "down");

    await act(async () => {
      resposta.resolve([r2, r1]);
    });
    expect(result.current.reports.map((r) => r.id)).toEqual([2, 1]);
    expect(result.current.movingReportId).toBeNull();
  });

  it("mostra o erro e libera os botoes quando o movimento falha", async () => {
    moveReport.mockRejectedValue(new Error("500"));
    const { result } = await setupLoaded();

    await act(async () => {
      await result.current.moveReport(r1, "down");
    });

    expect(mocks.showToast).toHaveBeenCalledWith("Nao foi possivel mudar a ordem do relatorio.", "error");
    expect(result.current.movingReportId).toBeNull();
    expect(result.current.reports.map((r) => r.id)).toEqual([1, 2]);
  });
});

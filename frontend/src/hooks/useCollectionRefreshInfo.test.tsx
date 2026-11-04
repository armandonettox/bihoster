import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as reportsApi from "../api/reports";
import type { RefreshInfo } from "../api/reports";
import { deferred } from "../test-fixtures";
import { useCollectionRefreshInfo } from "./useCollectionRefreshInfo";

vi.mock("../api/reports", () => ({ getCollectionRefreshInfo: vi.fn() }));

const getInfo = vi.mocked(reportsApi.getCollectionRefreshInfo);

const INFO_1: Record<string, RefreshInfo> = { "1": { last_refresh: "2026-11-03T12:00:00Z", next_refresh: null } };

function setup(workspaceId: number | undefined, ids: number[]) {
  return renderHook(
    ({ ws, reportIds }: { ws: number | undefined; reportIds: number[] }) => useCollectionRefreshInfo(ws, reportIds),
    { initialProps: { ws: workspaceId, reportIds: ids } },
  );
}

beforeEach(() => {
  getInfo.mockResolvedValue(INFO_1);
});

describe("useCollectionRefreshInfo", () => {
  it("busca a info da colecao uma vez, mesmo com varios relatorios", async () => {
    const { result } = setup(3, [1, 2, 3, 4, 5]);

    await waitFor(() => expect(result.current).toEqual(INFO_1));

    expect(getInfo).toHaveBeenCalledTimes(1);
    expect(getInfo).toHaveBeenCalledWith(3);
  });

  it("nao busca nada sem colecao ou sem relatorios", () => {
    setup(undefined, [1]);
    setup(3, []);

    expect(getInfo).not.toHaveBeenCalled();
  });

  it("nao busca de novo quando a tela so renderiza outra vez com a mesma lista", async () => {
    const { result, rerender } = setup(3, [1, 2]);
    await waitFor(() => expect(result.current).toEqual(INFO_1));

    rerender({ ws: 3, reportIds: [1, 2] });

    expect(getInfo).toHaveBeenCalledTimes(1);
  });

  it("busca de novo quando um relatorio e acrescentado a colecao", async () => {
    const { result, rerender } = setup(3, [1, 2]);
    await waitFor(() => expect(result.current).toEqual(INFO_1));
    const nova = { "1": INFO_1["1"], "3": { last_refresh: "2026-11-04T08:00:00Z", next_refresh: null } };
    getInfo.mockResolvedValue(nova);

    rerender({ ws: 3, reportIds: [1, 2, 3] });

    await waitFor(() => expect(result.current).toEqual(nova));
    expect(getInfo).toHaveBeenCalledTimes(2);
  });

  it("ignora a resposta atrasada de uma colecao que ja foi trocada", async () => {
    const antiga = deferred<Record<string, RefreshInfo>>();
    const nova = deferred<Record<string, RefreshInfo>>();
    getInfo.mockReturnValueOnce(antiga.promise).mockReturnValueOnce(nova.promise);
    const { result, rerender } = setup(3, [1]);

    rerender({ ws: 4, reportIds: [10] });
    await act(async () => {
      nova.resolve({ "10": { last_refresh: "nova", next_refresh: null } });
    });
    await waitFor(() => expect(result.current["10"]?.last_refresh).toBe("nova"));

    await act(async () => {
      antiga.resolve({ "1": { last_refresh: "antiga", next_refresh: null } });
    });
    expect(result.current["1"]).toBeUndefined();
    expect(result.current["10"]?.last_refresh).toBe("nova");
  });

  it("fica sem info, sem erro, quando a requisicao falha", async () => {
    getInfo.mockRejectedValue(new Error("502"));
    const { result } = setup(3, [1]);

    await waitFor(() => expect(getInfo).toHaveBeenCalled());

    expect(result.current).toEqual({});
  });
});

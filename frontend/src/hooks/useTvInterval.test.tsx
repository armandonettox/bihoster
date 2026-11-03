import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as workspacesApi from "../api/workspaces";
import type { Workspace } from "../api/workspaces";
import { makeWorkspace } from "../test-fixtures";
import { useTvInterval } from "./useTvInterval";

const mocks = vi.hoisted(() => ({ showToast: vi.fn(), reload: vi.fn() }));

vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../api/workspaces", () => ({ updateWorkspace: vi.fn() }));

const updateWorkspace = vi.mocked(workspacesApi.updateWorkspace);

function setup(workspace: Workspace | null = makeWorkspace({ id: 5, tv_interval_seconds: 15 })) {
  return renderHook(({ ws }: { ws: Workspace | null }) => useTvInterval(ws, mocks.reload), {
    initialProps: { ws: workspace },
  });
}

beforeEach(() => {
  mocks.showToast.mockClear();
  mocks.reload.mockReset();
  mocks.reload.mockResolvedValue(undefined);
  updateWorkspace.mockResolvedValue(makeWorkspace());
});

describe("useTvInterval - valor inicial", () => {
  it("comeca com o intervalo salvo na colecao", () => {
    const { result } = setup(makeWorkspace({ tv_interval_seconds: 30 }));
    expect(result.current.draft).toBe("30");
  });

  it("acompanha o intervalo quando a colecao e recarregada com outro valor", () => {
    const { result, rerender } = setup(makeWorkspace({ id: 5, tv_interval_seconds: 15 }));

    rerender({ ws: makeWorkspace({ id: 5, tv_interval_seconds: 45 }) });

    expect(result.current.draft).toBe("45");
  });

  it("guarda o que a pessoa digita sem gravar nada ate sair do campo", () => {
    const { result } = setup();

    act(() => result.current.setDraft("40"));

    expect(result.current.draft).toBe("40");
    expect(updateWorkspace).not.toHaveBeenCalled();
  });
});

describe("useTvInterval - gravar", () => {
  it("grava o valor valido e recarrega as colecoes", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.commit("20");
    });

    expect(updateWorkspace).toHaveBeenCalledWith(5, { tv_interval_seconds: 20 });
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(result.current.draft).toBe("20");
  });

  it.each([
    ["1", "3"],
    ["2.4", "3"],
    ["99999", "3600"],
    ["12.6", "13"],
  ])("ajusta %s para dentro do intervalo permitido (%s)", async (digitado, esperado) => {
    const { result } = setup();

    await act(async () => {
      await result.current.commit(digitado);
    });

    expect(result.current.draft).toBe(esperado);
    expect(updateWorkspace).toHaveBeenCalledWith(5, { tv_interval_seconds: Number(esperado) });
  });

  it("nao chama a API quando o valor e igual ao salvo", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.commit("15");
    });

    expect(updateWorkspace).not.toHaveBeenCalled();
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(result.current.draft).toBe("15");
  });

  it("volta ao valor salvo quando o que foi digitado nao e um numero", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.commit("abc");
    });

    expect(updateWorkspace).not.toHaveBeenCalled();
    expect(result.current.draft).toBe("15");
  });

  it.each([[""], ["   "]])("campo vazio (%j) volta ao valor salvo em vez de gravar o minimo", async (vazio) => {
    const { result } = setup();

    await act(async () => {
      await result.current.commit(vazio);
    });

    expect(updateWorkspace).not.toHaveBeenCalled();
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(result.current.draft).toBe("15");
  });

  it("devolve o campo ao valor salvo e avisa quando a gravacao falha", async () => {
    updateWorkspace.mockRejectedValue(new Error("500"));
    const { result } = setup();

    await act(async () => {
      await result.current.commit("50");
    });

    expect(result.current.draft).toBe("15");
    expect(mocks.showToast).toHaveBeenCalledWith("Nao foi possivel salvar o intervalo da TV.", "error");
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it("nao faz nada sem colecao selecionada", async () => {
    const { result } = setup(null);

    await act(async () => {
      await result.current.commit("20");
    });

    expect(updateWorkspace).not.toHaveBeenCalled();
  });
});

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as aiApi from "../api/aiSettings";
import { useAiAccess } from "./useAiAccess";

vi.mock("../api/aiSettings", () => ({ getAIAccess: vi.fn() }));

const getAccess = vi.mocked(aiApi.getAIAccess);

beforeEach(() => {
  getAccess.mockReset();
});

describe("useAiAccess", () => {
  it("comeca carregando e sem acesso, ate o servidor responder", async () => {
    getAccess.mockResolvedValue({ can_manage: true, can_use: true });

    const { result } = renderHook(() => useAiAccess());

    expect(result.current).toEqual({ canManage: false, canUse: false, loading: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("traduz a resposta do servidor", async () => {
    getAccess.mockResolvedValue({ can_manage: false, can_use: true });

    const { result } = renderHook(() => useAiAccess());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ canManage: false, canUse: true, loading: false });
  });

  it("se a consulta falhar, assume sem acesso e para de carregar", async () => {
    getAccess.mockRejectedValue(new Error("500"));

    const { result } = renderHook(() => useAiAccess());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ canManage: false, canUse: false, loading: false });
  });
});

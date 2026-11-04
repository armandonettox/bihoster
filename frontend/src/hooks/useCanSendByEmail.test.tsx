import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as emailApi from "../api/emailSettings";
import { useCanSendByEmail } from "./useCanSendByEmail";

const mocks = vi.hoisted(() => ({ user: null as { is_platform_admin: boolean } | null }));

vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../api/emailSettings", () => ({ getEmailStatus: vi.fn() }));

const getEmailStatus = vi.mocked(emailApi.getEmailStatus);

beforeEach(() => {
  mocks.user = { is_platform_admin: true };
  getEmailStatus.mockResolvedValue({ configured: true });
});

describe("useCanSendByEmail", () => {
  it("administrador com o e-mail configurado pode enviar", async () => {
    const { result } = renderHook(() => useCanSendByEmail());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("administrador com o e-mail ainda nao configurado nao pode", async () => {
    getEmailStatus.mockResolvedValue({ configured: false });
    const { result } = renderHook(() => useCanSendByEmail());

    await waitFor(() => expect(getEmailStatus).toHaveBeenCalled());

    expect(result.current).toBe(false);
  });

  it("quem nao e administrador nao pode e nem consulta o servidor", () => {
    mocks.user = { is_platform_admin: false };
    const { result } = renderHook(() => useCanSendByEmail());

    expect(result.current).toBe(false);
    expect(getEmailStatus).not.toHaveBeenCalled();
  });

  it("sem ninguem logado tambem nao", () => {
    mocks.user = null;
    const { result } = renderHook(() => useCanSendByEmail());

    expect(result.current).toBe(false);
    expect(getEmailStatus).not.toHaveBeenCalled();
  });

  it("se a pessoa deixa de ser administradora o envio some, mesmo ja tendo sido liberado antes", async () => {
    const { result, rerender } = renderHook(() => useCanSendByEmail());
    await waitFor(() => expect(result.current).toBe(true));

    mocks.user = { is_platform_admin: false };
    rerender();

    expect(result.current).toBe(false);
  });

  it("se a consulta falhar o envio simplesmente nao aparece", async () => {
    getEmailStatus.mockRejectedValue(new Error("rede"));
    const { result } = renderHook(() => useCanSendByEmail());

    await waitFor(() => expect(getEmailStatus).toHaveBeenCalled());

    expect(result.current).toBe(false);
  });
});

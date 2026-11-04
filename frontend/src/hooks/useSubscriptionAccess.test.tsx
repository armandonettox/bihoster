import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as emailApi from "../api/emailSettings";
import { useSubscriptionAccess } from "./useSubscriptionAccess";

const mocks = vi.hoisted(() => ({ user: null as { is_platform_admin: boolean } | null }));

vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../api/emailSettings", () => ({ getEmailStatus: vi.fn() }));

const getEmailStatus = vi.mocked(emailApi.getEmailStatus);

beforeEach(() => {
  mocks.user = { is_platform_admin: false };
  getEmailStatus.mockReset();
  getEmailStatus.mockResolvedValue({ configured: true, allowed_domains: [] });
});

describe("useSubscriptionAccess", () => {
  it("administrador da colecao assina com o e-mail configurado, mesmo sem lista de dominios", async () => {
    const { result } = renderHook(() => useSubscriptionAccess("admin"));

    await waitFor(() => expect(result.current.canSubscribe).toBe(true));
  });

  it("administrador da plataforma assina mesmo sem papel na colecao", async () => {
    mocks.user = { is_platform_admin: true };
    const { result } = renderHook(() => useSubscriptionAccess(null));

    await waitFor(() => expect(result.current.canSubscribe).toBe(true));
  });

  it("editor sem lista de dominios nao assina", async () => {
    const { result } = renderHook(() => useSubscriptionAccess("editor"));

    await waitFor(() => expect(getEmailStatus).toHaveBeenCalled());

    expect(result.current.canSubscribe).toBe(false);
  });

  it("editor com lista de dominios assina e recebe a lista", async () => {
    getEmailStatus.mockResolvedValue({ configured: true, allowed_domains: ["empresa.com"] });
    const { result } = renderHook(() => useSubscriptionAccess("editor"));

    await waitFor(() => expect(result.current.canSubscribe).toBe(true));

    expect(result.current.allowedDomains).toEqual(["empresa.com"]);
  });

  it("leitor nunca assina e nem consulta o servidor", () => {
    const { result } = renderHook(() => useSubscriptionAccess("viewer"));

    expect(result.current.canSubscribe).toBe(false);
    expect(getEmailStatus).not.toHaveBeenCalled();
  });

  it("com o e-mail nao configurado ninguem assina", async () => {
    getEmailStatus.mockResolvedValue({ configured: false, allowed_domains: ["empresa.com"] });
    const { result } = renderHook(() => useSubscriptionAccess("admin"));

    await waitFor(() => expect(getEmailStatus).toHaveBeenCalled());

    expect(result.current.canSubscribe).toBe(false);
  });

  it("falha ao consultar o status esconde a assinatura", async () => {
    getEmailStatus.mockRejectedValue(new Error("rede"));
    const { result } = renderHook(() => useSubscriptionAccess("admin"));

    await waitFor(() => expect(getEmailStatus).toHaveBeenCalled());

    expect(result.current.canSubscribe).toBe(false);
  });

  it("sem ninguem logado nao assina", () => {
    mocks.user = null;
    const { result } = renderHook(() => useSubscriptionAccess("admin"));

    expect(result.current.canSubscribe).toBe(false);
    expect(getEmailStatus).not.toHaveBeenCalled();
  });
});

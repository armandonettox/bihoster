import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../api/access";
import * as emailApi from "../api/emailSettings";
import { ADMIN_ACCESS, AccessContext, buildAccess } from "../context/AccessContext";
import { useCanSendByEmail } from "./useCanSendByEmail";

const WS = 7;
const mocks = vi.hoisted(() => ({ me: null as unknown as MyAccess }));

vi.mock("../api/emailSettings", () => ({ getEmailStatus: vi.fn() }));

const getEmailStatus = vi.mocked(emailApi.getEmailStatus);

function wrapper({ children }: { children: ReactNode }) {
  return <AccessContext.Provider value={buildAccess(mocks.me)}>{children}</AccessContext.Provider>;
}

const comExportar: MyAccess = { is_admin: false, global_permissions: [], workspace_permissions: { [String(WS)]: ["colecao.ver", "relatorio.exportar"] } };
const semExportar: MyAccess = { is_admin: false, global_permissions: [], workspace_permissions: { [String(WS)]: ["colecao.ver", "relatorio.editar"] } };

const usar = (workspaceId: number | null = WS) => renderHook(() => useCanSendByEmail(workspaceId), { wrapper });

beforeEach(() => {
  mocks.me = ADMIN_ACCESS;
  getEmailStatus.mockReset();
  getEmailStatus.mockResolvedValue({ configured: true, allowed_domains: [] });
});

describe("useCanSendByEmail", () => {
  it("administrador da plataforma com o e-mail configurado pode enviar", async () => {
    const { result } = usar();

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("quem recebeu a permissao de exportar nesta colecao tambem pode", async () => {
    mocks.me = comExportar;
    const { result } = usar();

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("com o e-mail ainda nao configurado ninguem pode", async () => {
    getEmailStatus.mockResolvedValue({ configured: false, allowed_domains: [] });
    const { result } = usar();

    await waitFor(() => expect(getEmailStatus).toHaveBeenCalled());

    expect(result.current).toBe(false);
  });

  it("quem so edita relatorios nao pode e nem consulta o servidor", () => {
    mocks.me = semExportar;
    const { result } = usar();

    expect(result.current).toBe(false);
    expect(getEmailStatus).not.toHaveBeenCalled();
  });

  it("a permissao de exportar vale so na colecao em que foi dada", () => {
    mocks.me = comExportar;
    const { result } = usar(99);

    expect(result.current).toBe(false);
    expect(getEmailStatus).not.toHaveBeenCalled();
  });

  it("sem colecao escolhida ninguem pode", () => {
    mocks.me = comExportar;
    const { result } = usar(null);

    expect(result.current).toBe(false);
  });

  it("se a pessoa perde a permissao o envio some, mesmo ja tendo sido liberado antes", async () => {
    mocks.me = comExportar;
    const { result, rerender } = renderHook(() => useCanSendByEmail(WS), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));

    mocks.me = semExportar;
    rerender();

    expect(result.current).toBe(false);
  });

  it("se a consulta falhar o envio simplesmente nao aparece", async () => {
    getEmailStatus.mockRejectedValue(new Error("rede"));
    const { result } = usar();

    await waitFor(() => expect(getEmailStatus).toHaveBeenCalled());

    expect(result.current).toBe(false);
  });
});

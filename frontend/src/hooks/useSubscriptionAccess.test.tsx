import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../api/access";
import * as emailApi from "../api/emailSettings";
import { ADMIN_ACCESS, AccessContext, buildAccess } from "../context/AccessContext";
import { useSubscriptionAccess } from "./useSubscriptionAccess";

const WS = 7;
const mocks = vi.hoisted(() => ({ user: null as { id: number } | null, me: null as unknown as MyAccess }));

vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../api/emailSettings", () => ({ getEmailStatus: vi.fn() }));

const getEmailStatus = vi.mocked(emailApi.getEmailStatus);

function wrapper({ children }: { children: ReactNode }) {
  return <AccessContext.Provider value={buildAccess(mocks.me)}>{children}</AccessContext.Provider>;
}

// O que a pessoa tem na colecao WS; "colecao.ver" ja vem junto
function naColecao(...chaves: string[]): MyAccess {
  return { is_admin: false, global_permissions: [], workspace_permissions: { [String(WS)]: ["colecao.ver", ...chaves] } };
}

const PERMISSOES_DE_EDITOR = [
  "assinatura.ver",
  "assinatura.criar",
  "assinatura.editar",
  "assinatura.excluir",
  "assinatura.executar",
  "alerta.ver",
  "alerta.criar",
  "alerta.editar",
  "alerta.excluir",
];

const usar = () => renderHook(() => useSubscriptionAccess(WS), { wrapper });

/** Espera a consulta ao servidor de e-mail ser feita E a resposta ser aplicada na tela, antes de conferir o resultado */
async function esperarStatus() {
  await waitFor(() => expect(getEmailStatus).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.user = { id: 1 };
  mocks.me = naColecao(...PERMISSOES_DE_EDITOR, "assinatura.qualquer-dominio");
  getEmailStatus.mockReset();
  getEmailStatus.mockResolvedValue({ configured: true, allowed_domains: [] });
});

describe("useSubscriptionAccess", () => {
  it("quem pode enviar para qualquer dominio assina com o e-mail configurado, mesmo sem lista de dominios", async () => {
    const { result } = usar();

    await waitFor(() => expect(result.current.canSubscribe).toBe(true));
    expect(result.current.subscriptions).toEqual({ create: true, edit: true, delete: true, run: true });
    expect(result.current.canAlert).toBe(true);
  });

  it("administrador da plataforma assina em qualquer colecao", async () => {
    mocks.me = ADMIN_ACCESS;
    const { result } = usar();

    await waitFor(() => expect(result.current.canSubscribe).toBe(true));
    expect(result.current.subscriptions.create).toBe(true);
  });

  it("sem a permissao de qualquer dominio e sem lista de dominios, ve as assinaturas mas nao cria, edita nem envia", async () => {
    mocks.me = naColecao(...PERMISSOES_DE_EDITOR);
    const { result } = usar();

    await esperarStatus();

    expect(result.current.canSubscribe).toBe(true);
    expect(result.current.subscriptions).toEqual({ create: false, edit: false, delete: true, run: false });
    // Alertas nao dependem da lista de dominios
    expect(result.current.alerts).toEqual({ create: true, edit: true, delete: true });
  });

  it("com lista de dominios o editor cria, e recebe a lista", async () => {
    mocks.me = naColecao(...PERMISSOES_DE_EDITOR);
    getEmailStatus.mockResolvedValue({ configured: true, allowed_domains: ["empresa.com"] });
    const { result } = usar();

    await waitFor(() => expect(result.current.subscriptions.create).toBe(true));

    expect(result.current.allowedDomains).toEqual(["empresa.com"]);
    expect(result.current.subscriptions.edit).toBe(true);
  });

  it("leitor nao ve nada e nem consulta o servidor", () => {
    mocks.me = naColecao();
    const { result } = usar();

    expect(result.current.canSubscribe).toBe(false);
    expect(result.current.canAlert).toBe(false);
    expect(getEmailStatus).not.toHaveBeenCalled();
  });

  it("cada acao segue a sua permissao: so ver nao da criar, editar, excluir nem enviar", async () => {
    mocks.me = naColecao("assinatura.ver", "alerta.ver");
    const { result } = usar();

    await esperarStatus();

    expect(result.current.canSubscribe).toBe(true);
    expect(result.current.subscriptions).toEqual({ create: false, edit: false, delete: false, run: false });
    expect(result.current.alerts).toEqual({ create: false, edit: false, delete: false });
  });

  it("assinaturas e alertas sao independentes", async () => {
    mocks.me = naColecao("assinatura.ver");
    const { result } = usar();

    await esperarStatus();

    expect(result.current.canSubscribe).toBe(true);
    expect(result.current.canAlert).toBe(false);
  });

  it("a permissao vale so na colecao em que foi dada", () => {
    mocks.me = { is_admin: false, global_permissions: [], workspace_permissions: { "99": ["colecao.ver", "assinatura.ver"] } };
    const { result } = usar();

    expect(result.current.canSubscribe).toBe(false);
    expect(getEmailStatus).not.toHaveBeenCalled();
  });

  it("com o e-mail nao configurado ninguem assina nem cria alerta", async () => {
    getEmailStatus.mockResolvedValue({ configured: false, allowed_domains: ["empresa.com"] });
    const { result } = usar();

    await esperarStatus();

    expect(result.current.canSubscribe).toBe(false);
    expect(result.current.canAlert).toBe(false);
  });

  it("falha ao consultar o status esconde os botoes", async () => {
    getEmailStatus.mockRejectedValue(new Error("rede"));
    const { result } = usar();

    await esperarStatus();

    expect(result.current.canSubscribe).toBe(false);
  });

  it("sem ninguem logado nao assina", () => {
    mocks.user = null;
    const { result } = usar();

    expect(result.current.canSubscribe).toBe(false);
    expect(getEmailStatus).not.toHaveBeenCalled();
  });
});

describe("useSubscriptionAccess: permissao por relatorio", () => {
  const REL = 31;
  const porRelatorio = (...chaves: string[]): MyAccess => ({
    is_admin: false,
    global_permissions: [],
    workspace_permissions: {},
    report_permissions: { [String(REL)]: chaves },
  });
  const usarNoRelatorio = (relatorio = REL) => renderHook(() => useSubscriptionAccess(WS, relatorio), { wrapper });

  it("o que foi dado so num relatorio vale nele", async () => {
    mocks.me = porRelatorio("assinatura.ver", "assinatura.criar", "assinatura.qualquer-dominio", "alerta.ver");
    const { result } = usarNoRelatorio();

    await waitFor(() => expect(result.current.canSubscribe).toBe(true));
    expect(result.current.subscriptions.create).toBe(true);
    expect(result.current.subscriptions.delete).toBe(false);
    expect(result.current.canAlert).toBe(true);
    expect(result.current.alerts.create).toBe(false);
  });

  it("nao vale no outro relatorio da mesma colecao", async () => {
    mocks.me = porRelatorio("assinatura.ver", "alerta.ver");
    const { result } = usarNoRelatorio(32);

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.canSubscribe).toBe(false);
    expect(result.current.canAlert).toBe(false);
    expect(getEmailStatus).not.toHaveBeenCalled();
  });
});


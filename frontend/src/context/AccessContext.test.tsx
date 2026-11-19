import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as accessApi from "../api/access";
import { AccessProvider, ADMIN_ACCESS, buildAccess, useAccess } from "./AccessContext";

const mocks = vi.hoisted(() => ({ user: { current: { id: 1 } as { id: number } | null } }));

vi.mock("./AuthContext", () => ({ useAuth: () => ({ user: mocks.user.current }) }));
vi.mock("../api/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/access")>()),
  getMyAccess: vi.fn(),
}));

const getMyAccess = vi.mocked(accessApi.getMyAccess);

const MARIA: accessApi.MyAccess = {
  is_admin: false,
  global_permissions: ["membros.ver", "ia.usar"],
  workspace_permissions: { "3": ["colecao.ver", "relatorio.publicar"], "5": ["colecao.ver"] },
};

describe("buildAccess", () => {
  it("sem dados, ninguém pode nada", () => {
    const access = buildAccess(null);
    expect(access.isAdmin).toBe(false);
    expect(access.can("membros.ver")).toBe(false);
    expect(access.canIn("colecao.ver", 3)).toBe(false);
    expect(access.canInAny("colecao.ver")).toBe(false);
  });

  it("administrador da plataforma pode tudo, mesmo fora da lista", () => {
    const access = buildAccess(ADMIN_ACCESS);
    expect(access.can("qualquer.coisa")).toBe(true);
    expect(access.canIn("relatorio.excluir", 99)).toBe(true);
    expect(access.canInAny("colecao.excluir")).toBe(true);
    expect(access.canAny("a", "b")).toBe(true);
  });

  it("permissão do sistema todo e permissão por coleção são coisas diferentes", () => {
    const access = buildAccess(MARIA);
    expect(access.can("membros.ver")).toBe(true);
    expect(access.can("membros.adicionar")).toBe(false);
    // Uma permissão de coleção não vale como global, e uma global não vale numa coleção
    expect(access.can("relatorio.publicar")).toBe(false);
    expect(access.canIn("membros.ver", 3)).toBe(false);
  });

  it("por coleção vale só na coleção em que foi dada", () => {
    const access = buildAccess(MARIA);
    expect(access.canIn("relatorio.publicar", 3)).toBe(true);
    expect(access.canIn("relatorio.publicar", 5)).toBe(false);
    expect(access.canIn("relatorio.publicar", 9)).toBe(false);
    expect(access.canIn("relatorio.publicar", null)).toBe(false);
    expect(access.canIn("relatorio.publicar", undefined)).toBe(false);
  });

  it("em alguma coleção e algum destes itens", () => {
    const access = buildAccess(MARIA);
    expect(access.canInAny("relatorio.publicar")).toBe(true);
    expect(access.canInAny("relatorio.excluir")).toBe(false);
    expect(access.canAny("grupos.ver", "membros.ver")).toBe(true);
    expect(access.canAny("grupos.ver", "sistema.email")).toBe(false);
    expect(access.canAny()).toBe(false);
  });
});

function Painel() {
  const access = useAccess();
  return (
    <div>
      <span>{access.loading ? "carregando" : "pronto"}</span>
      <span>{access.can("membros.ver") ? "ve-membros" : "sem-membros"}</span>
      <span>{access.canIn("relatorio.publicar", 3) ? "publica-3" : "nao-publica-3"}</span>
    </div>
  );
}

describe("AccessProvider", () => {
  beforeEach(() => {
    getMyAccess.mockReset();
    mocks.user.current = { id: 1 };
  });

  it("busca as permissões da pessoa logada e responde por elas", async () => {
    getMyAccess.mockResolvedValue(MARIA);
    render(
      <AccessProvider>
        <Painel />
      </AccessProvider>,
    );

    expect(screen.getByText("carregando")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("pronto")).toBeTruthy());
    expect(screen.getByText("ve-membros")).toBeTruthy();
    expect(screen.getByText("publica-3")).toBeTruthy();
    expect(getMyAccess).toHaveBeenCalledTimes(1);
  });

  it("sem sessão não busca nada e ninguém pode nada", async () => {
    mocks.user.current = null;
    render(
      <AccessProvider>
        <Painel />
      </AccessProvider>,
    );

    await waitFor(() => expect(screen.getByText("pronto")).toBeTruthy());
    expect(screen.getByText("sem-membros")).toBeTruthy();
    expect(getMyAccess).not.toHaveBeenCalled();
  });

  it("se a busca falhar, assume sem permissão nenhuma", async () => {
    getMyAccess.mockRejectedValue(new Error("falhou"));
    render(
      <AccessProvider>
        <Painel />
      </AccessProvider>,
    );

    await waitFor(() => expect(screen.getByText("pronto")).toBeTruthy());
    expect(screen.getByText("sem-membros")).toBeTruthy();
    expect(screen.getByText("nao-publica-3")).toBeTruthy();
  });

  it("usar fora do provedor avisa em vez de esconder o erro", () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Painel />)).toThrow(/AccessProvider/);
    erro.mockRestore();
  });
});

describe("buildAccess - holds (o que o rascunho de permissoes consulta)", () => {
  it("global e por colecao, pelo nome do escopo", () => {
    const access = buildAccess(MARIA);

    expect(access.holds("global", "membros.ver")).toBe(true);
    expect(access.holds("global", "membros.adicionar")).toBe(false);
    expect(access.holds("3", "relatorio.publicar")).toBe(true);
    expect(access.holds("5", "relatorio.publicar")).toBe(false);
    expect(access.holds("9", "colecao.ver")).toBe(false);
  });

  it("uma permissao de coleção nao vale como global, e uma global nao vale numa coleção", () => {
    const access = buildAccess(MARIA);

    expect(access.holds("global", "relatorio.publicar")).toBe(false);
    expect(access.holds("3", "membros.ver")).toBe(false);
  });

  it("o administrador da plataforma tem tudo em qualquer escopo", () => {
    const access = buildAccess(ADMIN_ACCESS);

    expect(access.holds("global", "qualquer.coisa")).toBe(true);
    expect(access.holds("77", "relatorio.excluir")).toBe(true);
  });
});

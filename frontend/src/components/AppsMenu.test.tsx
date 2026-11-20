import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../api/access";
import { ADMIN_ACCESS, AccessContext, buildAccess } from "../context/AccessContext";
import AppsMenu from "./AppsMenu";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setPanelOpen: vi.fn(),
  canUse: false,
  canViewAnalytics: false,
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../hooks/useAnalyticsAccess", () => ({
  useAnalyticsAccess: () => ({ canView: mocks.canViewAnalytics, canCreate: false, canEdit: false, canDelete: false, loading: false }),
}));
vi.mock("../context/ChatContext", () => ({
  useChat: () => ({ canUse: mocks.canUse, setPanelOpen: mocks.setPanelOpen }),
}));

function renderMenu(globais: string[] = [], opcoes: { admin?: boolean; colecoes?: Record<string, string[]> } = {}) {
  const me: MyAccess = opcoes.admin
    ? ADMIN_ACCESS
    : { is_admin: false, global_permissions: globais, workspace_permissions: opcoes.colecoes ?? {} };
  return render(
    <AccessContext.Provider value={buildAccess(me)}>
      <AppsMenu />
    </AccessContext.Provider>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Modulos" }));
}

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.setPanelOpen.mockReset();
  mocks.canUse = false;
  mocks.canViewAnalytics = false;
});

describe("AppsMenu", () => {
  it("sem nenhum modulo disponivel, o botao nem aparece", () => {
    renderMenu([], { colecoes: { "1": ["colecao.ver"] } });
    expect(screen.queryByRole("button", { name: "Modulos" })).toBeNull();
  });

  it("quem tem uma aba da Administracao ve Administracao, que abre Configuracoes", () => {
    renderMenu(["sistema.geral"]);
    openMenu();

    expect(screen.queryByRole("button", { name: "Chat de IA" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Administracao" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/settings");
    expect(screen.queryByRole("button", { name: "Administracao" })).toBeNull(); // menu fechou
  });

  it.each(["sistema.geral", "sistema.email", "ia.registro", "sistema.versao", "sistema.cache"])(
    "o item %s ja basta para mostrar a Administracao",
    (chave) => {
      renderMenu([chave]);
      openMenu();
      expect(screen.getByRole("button", { name: "Administracao" })).toBeTruthy();
    },
  );

  it("quem pode ver todas as colecoes ve Coleções, que abre a pagina propria e nao a Administracao", () => {
    renderMenu(["colecao.todas"]);
    openMenu();

    expect(screen.queryByRole("button", { name: "Administracao" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Assinaturas" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Coleções" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/collections");
  });

  it("quem pode ver todas as assinaturas ve Assinaturas, que abre a pagina propria e nao a Administracao", () => {
    renderMenu(["assinatura.todas"]);
    openMenu();

    expect(screen.queryByRole("button", { name: "Administracao" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Coleções" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Assinaturas" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/subscriptions");
  });

  it("quem pode ver os membros ve Gerenciar usuarios, que abre a pagina propria e nao as Configuracoes", () => {
    renderMenu(["membros.ver"]);
    openMenu();

    expect(screen.queryByRole("button", { name: "Administracao" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Gerenciar usuarios" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/users");
  });

  it("so ver os grupos tambem abre Gerenciar usuarios", () => {
    renderMenu(["grupos.ver"]);
    openMenu();

    expect(screen.getByRole("button", { name: "Gerenciar usuarios" })).toBeTruthy();
  });

  it("Administracao e Gerenciar usuarios sao itens separados: quem tem os dois ve os dois", () => {
    renderMenu(["membros.ver", "sistema.cache"]);
    openMenu();

    expect(screen.getByRole("button", { name: "Gerenciar usuarios" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Administracao" })).toBeTruthy();
  });

  it("quem so tem uma aba de Configuracoes nao ve Gerenciar usuarios", () => {
    renderMenu(["sistema.cache"]);
    openMenu();

    expect(screen.queryByRole("button", { name: "Gerenciar usuarios" })).toBeNull();
  });

  it("administrar uma colecao (editar, publicar) nao mostra a Administracao do sistema", () => {
    renderMenu([], { colecoes: { "1": ["colecao.ver", "colecao.editar", "colecao.excluir", "relatorio.publicar"] } });
    expect(screen.queryByRole("button", { name: "Modulos" })).toBeNull();
  });

  it("quem pode ver o log geral ve Auditoria, que abre a pagina propria", () => {
    renderMenu(["auditoria.ver"]);
    openMenu();

    expect(screen.queryByRole("button", { name: "Administracao" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Auditoria" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/audit");
  });

  it("quem so tem Administracao nao ve Auditoria", () => {
    renderMenu(["sistema.versao"]);
    openMenu();

    expect(screen.queryByRole("button", { name: "Auditoria" })).toBeNull();
  });

  it("quem usa o chat ve Chat de IA, que abre o painel do chat", () => {
    mocks.canUse = true;
    renderMenu();
    openMenu();

    expect(screen.queryByRole("button", { name: "Administracao" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chat de IA" }));

    expect(mocks.setPanelOpen).toHaveBeenCalledWith(true);
  });

  it("quem tem os dois modulos ve os dois itens", () => {
    mocks.canUse = true;
    renderMenu(["sistema.email"]);
    openMenu();

    expect(screen.getByRole("button", { name: "Administracao" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chat de IA" })).toBeTruthy();
  });

  it("quem so pode ver analiticos ve o item Analiticos, que abre a pagina", () => {
    mocks.canViewAnalytics = true;
    renderMenu();
    openMenu();
    expect(screen.queryByText("Auditoria")).toBeNull();
    fireEvent.click(screen.getByText("Analiticos"));
    expect(mocks.navigate).toHaveBeenCalledWith("/audit");
  });

  it("quem ve o log geral nao ve Analiticos separado: eles ficam dentro da Auditoria", () => {
    mocks.canViewAnalytics = true;
    renderMenu(["auditoria.ver"]);
    openMenu();

    expect(screen.getByRole("button", { name: "Auditoria" })).toBeTruthy();
    expect(screen.queryByText("Analiticos")).toBeNull();
  });

  it("administrador da plataforma ve Administracao e Auditoria", () => {
    renderMenu([], { admin: true });
    openMenu();

    expect(screen.getByRole("button", { name: "Administracao" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gerenciar usuarios" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Coleções" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assinaturas" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Auditoria" })).toBeTruthy();
  });
});

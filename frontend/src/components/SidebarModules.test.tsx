import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../api/access";
import { ADMIN_ACCESS, AccessContext, buildAccess } from "../context/AccessContext";
import SidebarModules from "./SidebarModules";

const mocks = vi.hoisted(() => ({ canViewAnalytics: false }));

vi.mock("../hooks/useAnalyticsAccess", () => ({
  useAnalyticsAccess: () => ({ canView: mocks.canViewAnalytics, canCreate: false, canEdit: false, canDelete: false, loading: false }),
}));

function renderModules(
  globais: string[] = [],
  opcoes: { admin?: boolean; colecoes?: Record<string, string[]>; rota?: string } = {},
) {
  const me: MyAccess = opcoes.admin
    ? ADMIN_ACCESS
    : { is_admin: false, global_permissions: globais, workspace_permissions: opcoes.colecoes ?? {} };
  return render(
    <MemoryRouter initialEntries={[opcoes.rota ?? "/"]}>
      <AccessContext.Provider value={buildAccess(me)}>
        <SidebarModules />
      </AccessContext.Provider>
    </MemoryRouter>,
  );
}

function link(nome: string) {
  return screen.getByRole("link", { name: nome });
}

beforeEach(() => {
  mocks.canViewAnalytics = false;
});

describe("SidebarModules", () => {
  it("sem nenhum modulo disponivel, nao mostra nada", () => {
    renderModules([], { colecoes: { "1": ["colecao.ver"] } });
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("administrar uma colecao (editar, publicar) nao mostra modulo nenhum", () => {
    renderModules([], { colecoes: { "1": ["colecao.ver", "colecao.editar", "colecao.excluir", "relatorio.publicar"] } });
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("quem tem uma aba da Administracao ve Administracao, que leva as Configuracoes", () => {
    renderModules(["sistema.geral"]);
    expect(link("Administração").getAttribute("href")).toBe("/settings");
    expect(screen.queryByRole("link", { name: "Coleções" })).toBeNull();
  });

  it.each(["sistema.geral", "sistema.email", "ia.registro", "sistema.versao", "sistema.cache"])(
    "o item %s ja basta para mostrar a Administracao",
    (chave) => {
      renderModules([chave]);
      expect(link("Administração")).toBeTruthy();
    },
  );

  it("quem pode ver todas as colecoes ve Coleções, que leva a pagina propria", () => {
    renderModules(["colecao.todas"]);
    expect(link("Coleções").getAttribute("href")).toBe("/collections");
    expect(screen.queryByRole("link", { name: "Administração" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Assinaturas" })).toBeNull();
  });

  it("quem pode ver todas as assinaturas ve Assinaturas", () => {
    renderModules(["assinatura.todas"]);
    expect(link("Assinaturas").getAttribute("href")).toBe("/subscriptions");
    expect(screen.queryByRole("link", { name: "Coleções" })).toBeNull();
  });

  it("quem pode ver todos os alertas ve Alertas", () => {
    renderModules(["alerta.todas"]);
    expect(link("Alertas").getAttribute("href")).toBe("/alerts");
    expect(screen.queryByRole("link", { name: "Administração" })).toBeNull();
  });

  it("quem pode ver os membros ve Gerenciar usuarios e nao a Administracao", () => {
    renderModules(["membros.ver"]);
    expect(link("Gerenciar usuários").getAttribute("href")).toBe("/users");
    expect(screen.queryByRole("link", { name: "Administração" })).toBeNull();
  });

  it("so ver os grupos tambem mostra Gerenciar usuarios", () => {
    renderModules(["grupos.ver"]);
    expect(link("Gerenciar usuários")).toBeTruthy();
  });

  it("Administracao e Gerenciar usuarios sao itens separados", () => {
    renderModules(["membros.ver", "sistema.cache"]);
    expect(link("Gerenciar usuários")).toBeTruthy();
    expect(link("Administração")).toBeTruthy();
  });

  it("quem so tem uma aba de Configuracoes nao ve Gerenciar usuarios", () => {
    renderModules(["sistema.cache"]);
    expect(screen.queryByRole("link", { name: "Gerenciar usuários" })).toBeNull();
  });

  it("quem pode ver o log geral ve Auditoria", () => {
    renderModules(["auditoria.ver"]);
    expect(link("Auditoria").getAttribute("href")).toBe("/audit");
    expect(screen.queryByRole("link", { name: "Administração" })).toBeNull();
  });

  it("quem so tem Administracao nao ve Auditoria", () => {
    renderModules(["sistema.versao"]);
    expect(screen.queryByRole("link", { name: "Auditoria" })).toBeNull();
  });

  it("quem so pode ver analiticos ve o item Analiticos, que leva a Auditoria", () => {
    mocks.canViewAnalytics = true;
    renderModules();
    expect(screen.queryByRole("link", { name: "Auditoria" })).toBeNull();
    expect(link("Analíticos").getAttribute("href")).toBe("/audit");
  });

  it("quem ve o log geral nao ve Analiticos separado", () => {
    mocks.canViewAnalytics = true;
    renderModules(["auditoria.ver"]);
    expect(link("Auditoria")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Analíticos" })).toBeNull();
  });

  it("administrador da plataforma ve todos os modulos", () => {
    renderModules([], { admin: true });
    for (const nome of ["Gerenciar usuários", "Coleções", "Assinaturas", "Alertas", "Administração", "Auditoria"]) {
      expect(link(nome)).toBeTruthy();
    }
  });

  it("marca como ativo o modulo da pagina aberta, inclusive em subpaginas", () => {
    renderModules(["colecao.todas", "alerta.todas"], { rota: "/collections/3" });
    expect(link("Coleções").className).toContain("sidebar-home-link-active");
    expect(link("Coleções").getAttribute("aria-current")).toBe("page");
    expect(link("Alertas").className).not.toContain("sidebar-home-link-active");
  });
});

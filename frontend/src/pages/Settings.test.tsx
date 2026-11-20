import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { MyAccess } from "../api/access";
import { ADMIN_ACCESS, AccessContext, buildAccess } from "../context/AccessContext";
import Settings from "./Settings";

// As abas fazem chamadas de rede; aqui so importa qual delas a pagina escolhe mostrar.
// O import fica dentro da fabrica porque o vi.mock sobe pro topo do arquivo.
vi.mock("./settings/GeneralTab", async () => (await import("../test-stubs")).tabStub("tab:general"));
vi.mock("./settings/BrandTab", async () => (await import("../test-stubs")).tabStub("tab:brand"));
vi.mock("./settings/AuthTab", async () => (await import("../test-stubs")).tabStub("tab:auth"));
vi.mock("./settings/EmailTab", async () => (await import("../test-stubs")).tabStub("tab:email"));
vi.mock("./settings/AiTab", async () => (await import("../test-stubs")).tabStub("tab:ai"));
vi.mock("./settings/UpdatesTab", async () => (await import("../test-stubs")).tabStub("tab:updates"));
vi.mock("./settings/CacheTab", async () => (await import("../test-stubs")).tabStub("tab:cache"));

function acesso(globais: string[] = [], opcoes: { carregando?: boolean; admin?: boolean } = {}) {
  const me: MyAccess = opcoes.admin ? ADMIN_ACCESS : { is_admin: false, global_permissions: globais, workspace_permissions: {} };
  return buildAccess(me, opcoes.carregando ?? false);
}

// Pagina de mentira de Gerenciar usuarios: mostra para onde o link antigo levou (caminho e consulta)
function PaginaDeUsuarios() {
  const { pathname, search } = useLocation();
  return <div data-testid="users-page">{`${pathname}${search}`}</div>;
}

function renderAt(url: string, access = acesso()) {
  return render(
    <AccessContext.Provider value={access}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="/account" element={<div data-testid="account-page">pagina da conta</div>} />
          <Route path="/users" element={<PaginaDeUsuarios />} />
          <Route path="/audit" element={<div data-testid="audit-page">pagina da auditoria</div>} />
          <Route path="/collections" element={<div data-testid="collections-page">pagina das colecoes</div>} />
          <Route path="/subscriptions" element={<div data-testid="subscriptions-page">pagina das assinaturas</div>} />
        </Routes>
      </MemoryRouter>
    </AccessContext.Provider>,
  );
}

const content = () => screen.getByTestId("tab-content").textContent;
const onAccountPage = () => screen.queryByTestId("account-page") !== null;
const rotulos = () => screen.getAllByRole("tab").map((tab) => tab.textContent);

beforeEach(() => {
  window.localStorage.clear();
});

describe("Settings - quem nao tem nenhuma permissao de administracao", () => {
  it("sem nada para administrar, /settings vai para a pagina da conta", () => {
    renderAt("/settings");

    expect(onAccountPage()).toBe(true);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it.each(["general", "audit", "updates", "auth", "email", "ai", "brand"])(
    "?tab=%s na URL tambem vai para a conta, nunca mostra a aba de administracao",
    (tab) => {
      renderAt(`/settings?tab=${tab}`);
      expect(onAccountPage()).toBe(true);
      expect(screen.queryByTestId("tab-content")).toBeNull();
    },
  );

  it("uma aba de administracao lembrada de antes tambem nao vaza", () => {
    window.localStorage.setItem("settings_tab", "email");
    renderAt("/settings");
    expect(onAccountPage()).toBe(true);
  });

  it("permissao so de coleção (publicar, editar relatorios) nao abre nenhuma aba de administracao", () => {
    const access = buildAccess({
      is_admin: false,
      global_permissions: [],
      workspace_permissions: { "1": ["colecao.ver", "colecao.editar", "relatorio.publicar"] },
    });
    renderAt("/settings", access);
    expect(onAccountPage()).toBe(true);
  });
});

describe("Settings - uma aba para cada item", () => {
  it.each([
    ["sistema.geral", "Geral", "tab:general"],
    ["sistema.marca", "Marca", "tab:brand"],
    ["sistema.autenticacao", "Autenticação", "tab:auth"],
    ["sistema.email", "E-mail", "tab:email"],
    ["sistema.versao", "Atualizações", "tab:updates"],
    ["sistema.cache", "Cache", "tab:cache"],
  ])("%s mostra so a aba %s", (chave, rotulo, conteudo) => {
    renderAt("/settings", acesso([chave]));

    expect(content()).toBe(conteudo);
    expect(screen.queryByRole("tablist")).toBeNull(); // uma aba so, sem barra de abas
    expect(rotulo).toBeTruthy();
  });

  it.each(["ia.chaves", "ia.modelos", "ia.bloqueios", "ia.registro", "ia.consumo"])(
    "qualquer item de gerencia da IA (%s) mostra a aba IA",
    (chave) => {
      renderAt("/settings?tab=ai", acesso([chave]));

      expect(content()).toBe("tab:ai");
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Administração");
      expect(screen.getByText("Gerencie a IA do sistema.")).toBeTruthy();
    },
  );

  it("ver membros e grupos nao abre nenhuma aba: isso fica em Gerenciar usuarios, fora das Configuracoes", () => {
    renderAt("/settings", acesso(["membros.ver", "grupos.ver", "permissoes.editar"]));
    expect(onAccountPage()).toBe(true);
  });

  it("usar o chat de IA nao abre a configuracao", () => {
    renderAt("/settings", acesso(["ia.usar"]));
    expect(onAccountPage()).toBe(true);
  });

  it("quem so gerencia a IA continua sem acesso as outras abas pela URL", () => {
    renderAt("/settings?tab=cache", acesso(["ia.registro"]));
    expect(content()).toBe("tab:ai");
  });

  it("com varios itens aparecem so as abas deles, na ordem de sempre, e a primeira abre", () => {
    renderAt("/settings", acesso(["sistema.cache", "sistema.email", "sistema.marca"]));

    expect(rotulos()).toEqual(["Marca", "E-mail", "Cache"]);
    expect(content()).toBe("tab:brand");
  });

  it("uma aba que a pessoa nao pode ver na URL cai na primeira que pode", () => {
    renderAt("/settings?tab=cache", acesso(["sistema.marca", "sistema.email"]));

    expect(content()).toBe("tab:brand");
    expect(rotulos()).not.toContain("Cache");
  });
});

describe("Settings - administrador da plataforma", () => {
  const admin = () => acesso([], { admin: true });

  it("abre em Geral com todas as abas de administracao e sem Minha conta", () => {
    renderAt("/settings", admin());

    expect(content()).toBe("tab:general");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Administração");
    const labels = rotulos();
    expect(labels).not.toContain("Minha conta");
    expect(labels).not.toContain("Membros"); // ficam em Gerenciar usuarios
    expect(labels).not.toContain("Grupos");
    expect(labels).toContain("E-mail");
    expect(labels).toContain("IA");
    expect(labels).not.toContain("Auditoria"); // tem pagina propria
    expect(labels).not.toContain("Permissoes"); // o catalogo de niveis foi removido
    expect(labels).not.toContain("Coleções"); // tem pagina propria
    expect(labels).not.toContain("Assinaturas"); // tem pagina propria
    expect(labels).toHaveLength(7);
    expect(screen.getByText("Gerencie a marca, o e-mail, o login e as demais configurações do sistema.")).toBeTruthy();
  });

  it("link antigo ?tab=members vai para Gerenciar usuarios", () => {
    renderAt("/settings?tab=members", admin());
    expect(screen.getByTestId("users-page").textContent).toBe("/users");
    expect(screen.queryByTestId("tab-content")).toBeNull();
  });

  it("link antigo ?tab=groups vai para Gerenciar usuarios, ja na visao por grupo", () => {
    renderAt("/settings?tab=groups", admin());
    expect(screen.getByTestId("users-page").textContent).toBe("/users?view=groups");
  });

  it("link antigo ?tab=audit vai para a pagina de auditoria", () => {
    renderAt("/settings?tab=audit", admin());
    expect(screen.queryByTestId("audit-page")).not.toBeNull();
    expect(screen.queryByTestId("tab-content")).toBeNull();
  });

  it("link antigo ?tab=collections vai para a pagina de Colecoes", () => {
    renderAt("/settings?tab=collections", admin());
    expect(screen.queryByTestId("collections-page")).not.toBeNull();
    expect(screen.queryByTestId("tab-content")).toBeNull();
  });

  it("link antigo ?tab=subscriptions vai para a pagina de Assinaturas", () => {
    renderAt("/settings?tab=subscriptions", admin());
    expect(screen.queryByTestId("subscriptions-page")).not.toBeNull();
    expect(screen.queryByTestId("tab-content")).toBeNull();
  });

  it("?tab=email abre a aba de e-mail", () => {
    renderAt("/settings?tab=email", admin());
    expect(content()).toBe("tab:email");
  });

  it("?tab=ai abre a aba de IA", () => {
    renderAt("/settings?tab=ai", admin());
    expect(content()).toBe("tab:ai");
  });

  it("link antigo ?tab=account vai para a pagina da conta", () => {
    renderAt("/settings?tab=account", admin());
    expect(onAccountPage()).toBe(true);
  });

  it("as setas do teclado percorrem as abas e voltam ao comeco depois da ultima", () => {
    renderAt("/settings?tab=cache", admin());
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(content()).toBe("tab:general");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(content()).toBe("tab:cache");
  });
});

describe("Settings - carregando", () => {
  it("nao decide as abas antes de saber as permissoes da pessoa", () => {
    renderAt("/settings?tab=email", acesso([], { carregando: true }));

    expect(screen.queryByTestId("tab-content")).toBeNull();
    expect(onAccountPage()).toBe(false); // nao redireciona antes de saber
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

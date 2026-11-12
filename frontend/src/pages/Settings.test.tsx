import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "./Settings";

const mocks = vi.hoisted(() => ({
  workspaces: [] as { id: number; name: string; role: string }[],
  loading: false,
  canManageAi: false,
  aiLoading: false,
}));

vi.mock("../context/WorkspaceContext", () => ({
  useWorkspace: () => ({ workspaces: mocks.workspaces, loading: mocks.loading }),
}));
vi.mock("../hooks/useAiAccess", () => ({
  useAiAccess: () => ({ canManage: mocks.canManageAi, canUse: false, loading: mocks.aiLoading }),
}));

// As abas fazem chamadas de rede; aqui so importa qual delas a pagina escolhe mostrar.
// O import fica dentro da fabrica porque o vi.mock sobe pro topo do arquivo.
vi.mock("./settings/GeneralTab", async () => (await import("../test-stubs")).tabStub("tab:general"));
vi.mock("./settings/CollectionsTab", async () => (await import("../test-stubs")).tabStub("tab:collections"));
vi.mock("./settings/BrandTab", async () => (await import("../test-stubs")).tabStub("tab:brand"));
vi.mock("./settings/MembersTab", async () => (await import("../test-stubs")).tabStub("tab:members"));
vi.mock("./settings/GroupsTab", async () => (await import("../test-stubs")).tabStub("tab:groups"));
vi.mock("./settings/AuthTab", async () => (await import("../test-stubs")).tabStub("tab:auth"));
vi.mock("./settings/EmailTab", async () => (await import("../test-stubs")).tabStub("tab:email"));
vi.mock("./settings/AiTab", async () => (await import("../test-stubs")).tabStub("tab:ai"));
vi.mock("./settings/SubscriptionsTab", async () => (await import("../test-stubs")).tabStub("tab:subscriptions"));
vi.mock("./settings/UpdatesTab", async () => (await import("../test-stubs")).tabStub("tab:updates"));
vi.mock("./settings/CacheTab", async () => (await import("../test-stubs")).tabStub("tab:cache"));

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/account" element={<div data-testid="account-page">pagina da conta</div>} />
        <Route path="/audit" element={<div data-testid="audit-page">pagina da auditoria</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const content = () => screen.getByTestId("tab-content").textContent;
const onAccountPage = () => screen.queryByTestId("account-page") !== null;

beforeEach(() => {
  mocks.workspaces = [];
  mocks.loading = false;
  mocks.canManageAi = false;
  mocks.aiLoading = false;
  window.localStorage.clear();
});

describe("Settings - quem nao administra nenhuma colecao", () => {
  beforeEach(() => {
    mocks.workspaces = [{ id: 1, name: "Comercial", role: "viewer" }];
  });

  it("sem nada para administrar, /settings vai para a pagina da conta", () => {
    renderAt("/settings");

    expect(onAccountPage()).toBe(true);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it.each(["members", "general", "audit", "updates", "auth", "email", "ai", "brand", "groups", "collections"])(
    "?tab=%s na URL tambem vai para a conta, nunca mostra a aba de administracao",
    (tab) => {
      renderAt(`/settings?tab=${tab}`);
      expect(onAccountPage()).toBe(true);
      expect(screen.queryByTestId("tab-content")).toBeNull();
    },
  );

  it("uma aba de administracao lembrada de antes tambem nao vaza", () => {
    window.localStorage.setItem("settings_tab", "members");
    renderAt("/settings");
    expect(onAccountPage()).toBe(true);
  });

  it("editor tambem vai para a conta (so administrador ve as abas)", () => {
    mocks.workspaces = [{ id: 1, name: "Comercial", role: "editor" }];
    renderAt("/settings");
    expect(onAccountPage()).toBe(true);
  });

  it("quem so gerencia a IA ve so a aba IA, sem Minha conta", () => {
    mocks.canManageAi = true;
    renderAt("/settings?tab=ai");

    expect(content()).toBe("tab:ai");
    expect(screen.queryByRole("tablist")).toBeNull(); // uma aba so, sem barra de abas
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Configuracoes");
  });

  it("quem so gerencia a IA continua sem acesso as outras abas pela URL", () => {
    mocks.canManageAi = true;
    renderAt("/settings?tab=members");

    expect(content()).toBe("tab:ai");
  });
});

describe("Settings - quem administra alguma colecao", () => {
  beforeEach(() => {
    mocks.workspaces = [{ id: 1, name: "Comercial", role: "admin" }];
    mocks.canManageAi = true;
  });

  it("sem a permissao Gerenciar IA a aba IA nao aparece e ?tab=ai cai em Geral", () => {
    mocks.canManageAi = false;
    renderAt("/settings?tab=ai");

    expect(content()).toBe("tab:general");
    const labels = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(labels).not.toContain("IA");
    expect(labels).toHaveLength(10);
  });

  it("abre em Geral com as abas de administracao e sem Minha conta", () => {
    renderAt("/settings");

    expect(content()).toBe("tab:general");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Configuracoes");
    const labels = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(labels).not.toContain("Minha conta");
    expect(labels).toContain("Membros");
    expect(labels).toContain("E-mail");
    expect(labels).toContain("IA");
    expect(labels).not.toContain("Auditoria"); // tem pagina propria
    expect(labels).not.toContain("Permissoes"); // o catalogo de niveis foi removido
    expect(labels).toHaveLength(11);
  });

  it("link antigo ?tab=audit vai para a pagina de auditoria", () => {
    renderAt("/settings?tab=audit");
    expect(screen.queryByTestId("audit-page")).not.toBeNull();
    expect(screen.queryByTestId("tab-content")).toBeNull();
  });

  it("?tab=email abre a aba de e-mail", () => {
    renderAt("/settings?tab=email");
    expect(content()).toBe("tab:email");
  });

  it("?tab=ai abre a aba de IA", () => {
    renderAt("/settings?tab=ai");
    expect(content()).toBe("tab:ai");
  });

  it("link antigo ?tab=account vai para a pagina da conta", () => {
    renderAt("/settings?tab=account");
    expect(onAccountPage()).toBe(true);
  });

  it("as setas do teclado percorrem as abas e voltam ao comeco depois da ultima", () => {
    renderAt("/settings?tab=cache");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(content()).toBe("tab:general");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(content()).toBe("tab:cache");
  });
});

describe("Settings - carregando", () => {
  it("tambem espera saber a permissao de IA antes de decidir as abas", () => {
    mocks.workspaces = [{ id: 1, name: "Comercial", role: "viewer" }];
    mocks.aiLoading = true;
    renderAt("/settings?tab=ai");

    expect(screen.queryByTestId("tab-content")).toBeNull();
    expect(onAccountPage()).toBe(false); // nao redireciona antes de saber
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("nao decide as abas antes de saber o papel da pessoa", () => {
    mocks.loading = true;
    mocks.workspaces = [];
    renderAt("/settings?tab=members");

    expect(screen.queryByTestId("tab-content")).toBeNull();
    expect(onAccountPage()).toBe(false);
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

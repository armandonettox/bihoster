import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "./Settings";

const mocks = vi.hoisted(() => ({
  workspaces: [] as { id: number; name: string; role: string }[],
  loading: false,
}));

vi.mock("../context/WorkspaceContext", () => ({
  useWorkspace: () => ({ workspaces: mocks.workspaces, loading: mocks.loading }),
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
vi.mock("./settings/AuditTab", async () => (await import("../test-stubs")).tabStub("tab:audit"));
vi.mock("./settings/UpdatesTab", async () => (await import("../test-stubs")).tabStub("tab:updates"));
vi.mock("./settings/AccountTab", async () => (await import("../test-stubs")).tabStub("tab:account"));
vi.mock("./settings/PermissoesTab", async () => (await import("../test-stubs")).tabStub("tab:permissoes"));
vi.mock("./settings/CacheTab", async () => (await import("../test-stubs")).tabStub("tab:cache"));

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Settings />
    </MemoryRouter>,
  );
}

const content = () => screen.getByTestId("tab-content").textContent;

beforeEach(() => {
  mocks.workspaces = [];
  mocks.loading = false;
  window.localStorage.clear();
});

describe("Settings - quem nao administra nenhuma colecao", () => {
  beforeEach(() => {
    mocks.workspaces = [{ id: 1, name: "Comercial", role: "viewer" }];
  });

  it("ve so a sua conta, sem abas de administracao", () => {
    renderAt("/settings");

    expect(content()).toBe("tab:account");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Minha conta");
  });

  it.each(["members", "general", "audit", "updates", "auth", "email", "ai", "brand", "groups", "collections"])(
    "?tab=%s na URL cai na conta, nunca mostra a aba de administracao",
    (tab) => {
      renderAt(`/settings?tab=${tab}`);
      expect(content()).toBe("tab:account");
    },
  );

  it("uma aba de administracao lembrada de antes tambem nao vaza", () => {
    window.localStorage.setItem("settings_tab", "members");
    renderAt("/settings");
    expect(content()).toBe("tab:account");
  });

  it("editor tambem so ve a conta (so administrador ve as abas)", () => {
    mocks.workspaces = [{ id: 1, name: "Comercial", role: "editor" }];
    renderAt("/settings");
    expect(content()).toBe("tab:account");
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

describe("Settings - quem administra alguma colecao", () => {
  beforeEach(() => {
    mocks.workspaces = [{ id: 1, name: "Comercial", role: "admin" }];
  });

  it("abre em Geral e tem a aba Minha conta junto com as demais", () => {
    renderAt("/settings");

    expect(content()).toBe("tab:general");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Configuracoes");
    const labels = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(labels).toContain("Minha conta");
    expect(labels).toContain("Membros");
    expect(labels).toContain("E-mail");
    expect(labels).toContain("IA");
    expect(labels).toHaveLength(14);
  });

  it("?tab=email abre a aba de e-mail", () => {
    renderAt("/settings?tab=email");
    expect(content()).toBe("tab:email");
  });

  it("?tab=ai abre a aba de IA", () => {
    renderAt("/settings?tab=ai");
    expect(content()).toBe("tab:ai");
  });

  it("?tab=account abre a conta", () => {
    renderAt("/settings?tab=account");
    expect(content()).toBe("tab:account");
  });

  it("clicar em Minha conta troca de aba", () => {
    renderAt("/settings");
    fireEvent.click(screen.getByRole("tab", { name: "Minha conta" }));
    expect(content()).toBe("tab:account");
  });

  it("as setas do teclado percorrem inclusive Minha conta", () => {
    renderAt("/settings?tab=cache");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(content()).toBe("tab:account");
    // E volta pro comeco depois da ultima
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(content()).toBe("tab:general");
  });
});

describe("Settings - carregando", () => {
  it("nao decide as abas antes de saber o papel da pessoa", () => {
    mocks.loading = true;
    mocks.workspaces = [];
    renderAt("/settings?tab=members");

    expect(screen.queryByTestId("tab-content")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

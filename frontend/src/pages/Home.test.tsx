import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "./Home";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router-dom")>();
  return { ...original, useNavigate: () => mockNavigate };
});

const mocks = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  loaded: false,
  workspaces: [] as { id: number; name: string }[],
  workspacesLoading: false,
  currentWorkspaceId: undefined as number | undefined,
  selectWorkspace: vi.fn(),
  userName: "Joao Silva",
}));

vi.mock("../context/BrandingContext", () => ({
  useBranding: () => ({
    settings: mocks.settings,
    loaded: mocks.loaded,
    reload: vi.fn(),
  }),
}));

vi.mock("../context/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspaces: mocks.workspaces,
    loading: mocks.workspacesLoading,
    currentWorkspace: mocks.currentWorkspaceId ? { id: mocks.currentWorkspaceId } : null,
    selectWorkspace: mocks.selectWorkspace,
  }),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { name: mocks.userName } }),
}));

vi.mock("./HomeDashboard", () => ({ default: () => <div data-testid="home-dashboard" /> }));

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

function settingsBase(overrides = {}) {
  return {
    default_workspace_id: null,
    single_collection_redirect: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockNavigate.mockClear();
  mocks.selectWorkspace.mockClear();
  mocks.settings = null;
  mocks.loaded = false;
  mocks.workspaces = [];
  mocks.workspacesLoading = false;
  mocks.currentWorkspaceId = undefined;
});

describe("Home - carregando", () => {
  it("nao renderiza nada enquanto settings ainda nao carregou", () => {
    mocks.loaded = false;
    mocks.workspacesLoading = false;
    renderHome();
    expect(screen.queryByTestId("home-dashboard")).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("nao renderiza nada enquanto workspaces ainda carrega", () => {
    mocks.loaded = true;
    mocks.workspacesLoading = true;
    mocks.settings = settingsBase();
    renderHome();
    expect(screen.queryByTestId("home-dashboard")).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("Home - toggle desligado", () => {
  beforeEach(() => {
    mocks.loaded = true;
    mocks.workspacesLoading = false;
  });

  it("mostra o painel com 1 colecao quando toggle esta off", () => {
    mocks.settings = settingsBase({ single_collection_redirect: false });
    mocks.workspaces = [{ id: 1, name: "Comercial" }];
    renderHome();
    expect(screen.getByTestId("home-dashboard")).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("mostra o painel com 0 colecoes", () => {
    mocks.settings = settingsBase({ single_collection_redirect: false });
    mocks.workspaces = [];
    renderHome();
    expect(screen.getByTestId("home-dashboard")).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("Home - toggle ligado", () => {
  beforeEach(() => {
    mocks.loaded = true;
    mocks.workspacesLoading = false;
    mocks.settings = settingsBase({ single_collection_redirect: true });
  });

  it("redireciona para /collection com replace quando usuario tem 1 colecao", () => {
    mocks.workspaces = [{ id: 5, name: "Vendas" }];
    renderHome();
    expect(mockNavigate).toHaveBeenCalledWith("/collection", { replace: true });
  });

  it("seleciona a colecao antes de navegar quando nao e a atual", () => {
    mocks.workspaces = [{ id: 5, name: "Vendas" }];
    mocks.currentWorkspaceId = undefined;
    renderHome();
    expect(mocks.selectWorkspace).toHaveBeenCalledWith(5);
  });

  it("nao reseleciona quando ja e a colecao atual", () => {
    mocks.workspaces = [{ id: 5, name: "Vendas" }];
    mocks.currentWorkspaceId = 5;
    renderHome();
    expect(mocks.selectWorkspace).not.toHaveBeenCalled();
  });

  it("mostra o painel com 2 colecoes", () => {
    mocks.workspaces = [
      { id: 1, name: "Vendas" },
      { id: 2, name: "Financeiro" },
    ];
    renderHome();
    expect(screen.getByTestId("home-dashboard")).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("mostra o painel com 0 colecoes", () => {
    mocks.workspaces = [];
    renderHome();
    expect(screen.getByTestId("home-dashboard")).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("Home - colecao inicial (default_workspace_id)", () => {
  beforeEach(() => {
    mocks.loaded = true;
    mocks.workspacesLoading = false;
  });

  it("colecao inicial tem prioridade sobre o toggle", () => {
    mocks.settings = settingsBase({ default_workspace_id: 3, single_collection_redirect: true });
    mocks.workspaces = [
      { id: 3, name: "RH" },
      { id: 4, name: "TI" },
    ];
    renderHome();
    expect(mockNavigate).toHaveBeenCalledWith("/collection", { replace: true });
    expect(mocks.selectWorkspace).toHaveBeenCalledWith(3);
  });

  it("colecao inicial sem acesso cai no toggle com 1 colecao", () => {
    mocks.settings = settingsBase({ default_workspace_id: 99, single_collection_redirect: true });
    mocks.workspaces = [{ id: 7, name: "Suporte" }];
    renderHome();
    expect(mockNavigate).toHaveBeenCalledWith("/collection", { replace: true });
    expect(mocks.selectWorkspace).toHaveBeenCalledWith(7);
  });

  it("colecao inicial sem acesso e toggle off mostra o painel", () => {
    mocks.settings = settingsBase({ default_workspace_id: 99, single_collection_redirect: false });
    mocks.workspaces = [{ id: 7, name: "Suporte" }];
    renderHome();
    expect(screen.getByTestId("home-dashboard")).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

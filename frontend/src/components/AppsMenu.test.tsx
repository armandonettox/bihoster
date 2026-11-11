import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppsMenu from "./AppsMenu";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setPanelOpen: vi.fn(),
  canUse: false,
  platformAdmin: false,
  workspaces: [] as { id: number; role: string }[],
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { is_platform_admin: mocks.platformAdmin } }) }));
vi.mock("../context/WorkspaceContext", () => ({ useWorkspace: () => ({ workspaces: mocks.workspaces }) }));
vi.mock("../context/ChatContext", () => ({
  useChat: () => ({ canUse: mocks.canUse, setPanelOpen: mocks.setPanelOpen }),
}));

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Modulos" }));
}

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.setPanelOpen.mockReset();
  mocks.canUse = false;
  mocks.platformAdmin = false;
  mocks.workspaces = [];
});

describe("AppsMenu", () => {
  it("sem nenhum modulo disponivel, o botao nem aparece", () => {
    mocks.workspaces = [{ id: 1, role: "viewer" }];
    render(<AppsMenu />);
    expect(screen.queryByRole("button", { name: "Modulos" })).toBeNull();
  });

  it("administrador ve Administracao, que abre Configuracoes", () => {
    mocks.workspaces = [{ id: 1, role: "admin" }];
    render(<AppsMenu />);
    openMenu();

    expect(screen.queryByRole("button", { name: "Chat de IA" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Administracao" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/settings");
    expect(screen.queryByRole("button", { name: "Administracao" })).toBeNull(); // menu fechou
  });

  it("administrador da plataforma ve Auditoria, que abre a pagina propria", () => {
    mocks.workspaces = [{ id: 1, role: "admin" }];
    mocks.platformAdmin = true;
    render(<AppsMenu />);
    openMenu();

    fireEvent.click(screen.getByRole("button", { name: "Auditoria" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/audit");
  });

  it("quem so administra uma colecao nao ve Auditoria", () => {
    mocks.workspaces = [{ id: 1, role: "admin" }];
    render(<AppsMenu />);
    openMenu();

    expect(screen.queryByRole("button", { name: "Auditoria" })).toBeNull();
  });

  it("quem usa o chat ve Chat de IA, que abre o painel do chat", () => {
    mocks.workspaces = [{ id: 1, role: "viewer" }];
    mocks.canUse = true;
    render(<AppsMenu />);
    openMenu();

    expect(screen.queryByRole("button", { name: "Administracao" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chat de IA" }));

    expect(mocks.setPanelOpen).toHaveBeenCalledWith(true);
  });

  it("quem tem os dois modulos ve os dois itens", () => {
    mocks.workspaces = [{ id: 1, role: "admin" }];
    mocks.canUse = true;
    render(<AppsMenu />);
    openMenu();

    expect(screen.getByRole("button", { name: "Administracao" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chat de IA" })).toBeTruthy();
  });
});

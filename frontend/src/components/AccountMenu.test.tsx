import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountMenu from "./AccountMenu";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  logout: vi.fn(),
  workspaces: [] as { id: number; role: string }[],
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { name: "Maria Souza", email: "maria@example.com" }, logout: mocks.logout }),
}));
vi.mock("../context/WorkspaceContext", () => ({ useWorkspace: () => ({ workspaces: mocks.workspaces }) }));
vi.mock("../context/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }) }));

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Menu da conta" }));
}

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.logout.mockReset();
  mocks.workspaces = [];
});

describe("AccountMenu", () => {
  it("todo usuario tem Minha conta, que abre a aba certa de Configuracoes", () => {
    mocks.workspaces = [{ id: 1, role: "viewer" }];
    render(<AccountMenu />);
    openMenu();

    fireEvent.click(screen.getByRole("button", { name: "Minha conta" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/settings?tab=account");
  });

  it("quem nao administra nada nao ve o item Configuracoes", () => {
    mocks.workspaces = [{ id: 1, role: "editor" }];
    render(<AccountMenu />);
    openMenu();

    expect(screen.queryByRole("button", { name: "Configuracoes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Minha conta" })).toBeTruthy();
  });

  it("administrador ve Configuracoes alem de Minha conta", () => {
    mocks.workspaces = [{ id: 1, role: "admin" }];
    render(<AccountMenu />);
    openMenu();

    fireEvent.click(screen.getByRole("button", { name: "Configuracoes" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/settings");
    expect(screen.queryByRole("button", { name: "Minha conta" })).toBeNull(); // menu fechou ao navegar
  });

  it("Sair continua funcionando", () => {
    render(<AccountMenu />);
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(mocks.logout).toHaveBeenCalled();
  });
});

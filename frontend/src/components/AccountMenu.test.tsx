import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountMenu from "./AccountMenu";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { name: "Maria Souza", email: "maria@example.com" }, logout: mocks.logout }),
}));

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Menu da conta" }));
}

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.logout.mockReset();
});

describe("AccountMenu", () => {
  it("Minha conta abre a pagina propria da conta e fecha o menu", () => {
    render(<AccountMenu />);
    openMenu();

    fireEvent.click(screen.getByRole("button", { name: "Minha conta" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/account");
    expect(screen.queryByRole("button", { name: "Minha conta" })).toBeNull();
  });

  it("o menu do perfil tem so Minha conta e Sair, os modulos ficam no outro menu", () => {
    render(<AccountMenu />);
    openMenu();

    expect(screen.getByRole("button", { name: "Minha conta" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sair" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Administracao" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Chat de IA" })).toBeNull();
  });

  it("sem foto mostra as iniciais no botao do perfil", () => {
    const { container } = render(<AccountMenu />);
    expect(container.querySelector(".user-avatar")?.textContent).toBe("MA");
    expect(container.querySelector("img")).toBeNull();
  });

  it("Sair continua funcionando", () => {
    render(<AccountMenu />);
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(mocks.logout).toHaveBeenCalled();
  });

  it("Esc fecha o menu", () => {
    render(<AccountMenu />);
    openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Minha conta" })).toBeNull();
  });
});

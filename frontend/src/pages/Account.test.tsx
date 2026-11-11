import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Account from "./Account";

// O formulario faz chamadas de rede; aqui so importa que a pagina mostra o titulo e a tela da conta.
vi.mock("./settings/AccountTab", async () => (await import("../test-stubs")).tabStub("tab:account"));

describe("Account", () => {
  it("mostra o titulo Minha conta e o formulario da conta, sem barra de abas", () => {
    render(<Account />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Minha conta");
    expect(screen.getByTestId("tab-content").textContent).toBe("tab:account");
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../api/settings";
import WorkspaceOnboarding from "./WorkspaceOnboarding";

const mocks = vi.hoisted(() => ({
  settings: null as unknown,
  canCreate: false,
  logout: vi.fn(),
}));

vi.mock("../context/BrandingContext", () => ({ useBranding: () => ({ settings: mocks.settings }) }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { name: "MARIA DA SILVA" }, logout: mocks.logout }) }));
vi.mock("../context/WorkspaceContext", () => ({ useWorkspace: () => ({ reload: vi.fn() }) }));
vi.mock("../context/AccessContext", () => ({ useAccess: () => ({ can: () => mocks.canCreate }) }));

function abrir(settings: Partial<AppSettings> = {}, podeCriar = false) {
  mocks.settings = settings;
  mocks.canCreate = podeCriar;
  return render(<WorkspaceOnboarding />);
}

beforeEach(() => {
  mocks.logout.mockReset();
});

describe("WorkspaceOnboarding - textos da marca", () => {
  it("sem personalização mostra o título com o nome formatado, a mensagem de sempre e o botão Sair", () => {
    abrir();

    expect(screen.getByRole("heading", { name: "Bem-vindo, Maria da Silva" })).toBeTruthy();
    expect(screen.getByText(/Você ainda não tem acesso a nenhuma coleção\. Peça para um administrador/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(mocks.logout).toHaveBeenCalled();
  });

  it("título, mensagem e botão personalizados trocam os de sempre", () => {
    abrir({ no_access_title: "Quase lá", no_access_message: "Falta alguém liberar uma coleção.", no_access_button: "Trocar de conta" });

    expect(screen.getByRole("heading", { name: "Quase lá" })).toBeTruthy();
    expect(screen.getByText("Falta alguém liberar uma coleção.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trocar de conta" }));
    expect(mocks.logout).toHaveBeenCalled();
  });

  it("quem pode criar coleção vê o formulário de criar e não a mensagem personalizada", () => {
    abrir({ no_access_message: "Falta alguém liberar uma coleção." }, true);

    expect(screen.getByRole("button", { name: "Criar colecao" })).toBeTruthy();
    expect(screen.queryByText("Falta alguém liberar uma coleção.")).toBeNull();
  });

  it("mostra a logo da marca quando existe e a padrão quando não", () => {
    const comLogo = abrir({ logo_url: "/static/uploads/minha-marca.png" });
    expect((comLogo.container.querySelector("img.auth-logo") as HTMLImageElement).getAttribute("src")).toContain("minha-marca.png");
    comLogo.unmount();

    const semLogo = abrir({ logo_url: null });
    expect(semLogo.container.querySelector("img[src*='/static/uploads/']")).toBeNull();
    expect(semLogo.container.querySelector(".auth-logo")).not.toBeNull();
  });
});

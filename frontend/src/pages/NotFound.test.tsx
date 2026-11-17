import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotFound from "./NotFound";

const mocks = vi.hoisted(() => ({ settings: null as unknown }));

vi.mock("../context/BrandingContext", () => ({ useBranding: () => ({ settings: mocks.settings }) }));

function abrir(settings: Record<string, unknown> | null = {}) {
  mocks.settings = settings === null ? null : { logo_url: null, ...settings };
  return render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.settings = null;
});

describe("NotFound", () => {
  it("sem personalização mostra os textos padrão, com acento, e o link para o início", () => {
    abrir();

    expect(screen.getByRole("heading", { level: 1, name: "Página não encontrada" })).toBeTruthy();
    expect(screen.getByText("404")).toBeTruthy();
    expect(screen.getByText("O endereço que você tentou acessar não existe ou foi removido.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Voltar para o início" });
    expect(link.getAttribute("href")).toBe("/");
  });

  it("com a marca ainda sem carregar usa os textos padrão", () => {
    abrir(null);

    expect(screen.getByRole("heading", { name: "Página não encontrada" })).toBeTruthy();
  });

  it("usa os textos personalizados da marca", () => {
    abrir({
      not_found_title: "Essa página sumiu",
      not_found_message: "Confira o endereço ou volte para o início do portal.",
      not_found_button: "Ir para o início",
    });

    expect(screen.getByRole("heading", { name: "Essa página sumiu" })).toBeTruthy();
    expect(screen.getByText("Confira o endereço ou volte para o início do portal.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ir para o início" }).getAttribute("href")).toBe("/");
    expect(screen.queryByText("Página não encontrada")).toBeNull();
  });

  it("personalizar só o título mantém a mensagem e o botão padrão", () => {
    abrir({ not_found_title: "Sumiu" });

    expect(screen.getByRole("heading", { name: "Sumiu" })).toBeTruthy();
    expect(screen.getByText("O endereço que você tentou acessar não existe ou foi removido.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voltar para o início" })).toBeTruthy();
  });

  it("o texto é mostrado como texto, nunca como HTML", () => {
    const { container } = abrir({ not_found_message: "<b>oi</b><img src=x onerror=alert(1)>" });

    expect(screen.getByText("<b>oi</b><img src=x onerror=alert(1)>")).toBeTruthy();
    expect(container.querySelector(".error-page-desc b")).toBeNull();
    expect(container.querySelector(".error-page-desc img")).toBeNull();
  });

  it("usa o logo da marca quando existe e o logo padrão quando não", () => {
    const { container, unmount } = abrir({ logo_url: "/static/uploads/logo.png" });
    expect(container.querySelector("img.error-page-logo")?.getAttribute("src")).toContain("logo.png");
    unmount();

    const outro = abrir({ logo_url: null });
    expect(outro.container.querySelector("img.error-page-logo[alt='Logo']")).toBeNull();
    expect(outro.container.querySelector(".error-page-logo")).not.toBeNull();
  });
});

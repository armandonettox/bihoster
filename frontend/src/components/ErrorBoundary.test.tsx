import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrandingContext } from "../context/brandingContextObject";
import type { AppSettings } from "../api/settings";
import ErrorBoundary from "./ErrorBoundary";

function Quebrado(): never {
  throw new Error("falhou de propósito");
}

function marca(settings: Partial<AppSettings> | null) {
  return { settings: settings as AppSettings | null, loaded: true, reload: async () => undefined };
}

function comMarca(valor: ReturnType<typeof marca> | undefined, filho = <Quebrado />, resetKey?: string) {
  return render(
    <BrandingContext.Provider value={valor}>
      <ErrorBoundary resetKey={resetKey}>{filho}</ErrorBoundary>
    </BrandingContext.Provider>,
  );
}

beforeEach(() => {
  // O React registra o erro no console; o teste provoca de propósito
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary - textos da tela de erro", () => {
  it("sem personalização mostra os textos padrão, com acento", () => {
    comMarca(marca({}));

    expect(screen.getByRole("heading", { name: "Algo deu errado" })).toBeTruthy();
    expect(screen.getByText("Ops")).toBeTruthy();
    expect(screen.getByText("Aconteceu um erro inesperado nesta tela. Você pode tentar voltar para o início.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Voltar para o início" })).toBeTruthy();
  });

  it("fora de qualquer provedor de marca (o ErrorBoundary de fora do app) usa os textos padrão e não quebra", () => {
    render(
      <ErrorBoundary>
        <Quebrado />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("heading", { name: "Algo deu errado" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Voltar para o início" })).toBeTruthy();
  });

  it("com a marca ainda sem carregar (settings nulo) usa os textos padrão", () => {
    comMarca(marca(null));

    expect(screen.getByRole("heading", { name: "Algo deu errado" })).toBeTruthy();
  });

  it("usa os textos personalizados da marca", () => {
    comMarca(
      marca({
        error_title: "Tivemos um problema",
        error_message: "Já estamos vendo isso. Tente de novo em instantes.",
        error_button: "Tentar de novo",
      }),
    );

    expect(screen.getByRole("heading", { name: "Tivemos um problema" })).toBeTruthy();
    expect(screen.getByText("Já estamos vendo isso. Tente de novo em instantes.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("os textos da página 404 não aparecem na tela de erro inesperado", () => {
    comMarca(marca({ not_found_title: "Essa página sumiu", error_title: null }));

    expect(screen.getByRole("heading", { name: "Algo deu errado" })).toBeTruthy();
    expect(screen.queryByText("Essa página sumiu")).toBeNull();
  });

  it("usa a logo da marca quando existe", () => {
    const { container } = comMarca(marca({ logo_url: "/static/uploads/minha-marca.png" }));

    const logo = container.querySelector("img.error-page-logo") as HTMLImageElement;
    expect(logo).not.toBeNull();
    expect(logo.getAttribute("src")).toContain("minha-marca.png");
  });

  it("se a imagem da logo não carregar, cai para a logo padrão e a tela continua", () => {
    const { container } = comMarca(marca({ logo_url: "/static/uploads/minha-marca.png" }));

    fireEvent.error(container.querySelector("img.error-page-logo") as HTMLImageElement);

    expect(container.querySelector("img[src*='minha-marca']")).toBeNull();
    expect(container.querySelector(".error-page-logo")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Algo deu errado" })).toBeTruthy();
  });

  it("sem logo da marca, ou fora de qualquer provedor, usa a logo padrão", () => {
    const semLogo = comMarca(marca({ logo_url: null }));
    expect(semLogo.container.querySelector("img[src*='/static/uploads/']")).toBeNull();
    expect(semLogo.container.querySelector(".error-page-logo")).not.toBeNull();
    semLogo.unmount();

    const { container } = render(
      <ErrorBoundary>
        <Quebrado />
      </ErrorBoundary>,
    );
    expect(container.querySelector("img[src*='/static/uploads/']")).toBeNull();
    expect(container.querySelector(".error-page-logo")).not.toBeNull();
  });

  it("o texto personalizado é mostrado como texto, nunca como HTML", () => {
    const { container } = comMarca(marca({ error_message: "<b>oi</b>" }));

    expect(screen.getByText("<b>oi</b>")).toBeTruthy();
    expect(container.querySelector(".error-page-desc b")).toBeNull();
  });

  it("o botão leva ao início", () => {
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { href: "/qualquer" } });
    comMarca(marca({ error_button: "Tentar de novo" }));

    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect((window.location as { href: string }).href).toBe("/");
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});

describe("ErrorBoundary - comportamento de sempre", () => {
  it("sem erro mostra o conteúdo normal", () => {
    comMarca(marca({}), <p>tudo certo</p>);

    expect(screen.getByText("tudo certo")).toBeTruthy();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("limpa o erro quando a chave de reinício muda (troca de rota)", () => {
    function Teste() {
      const [chave, setChave] = useState("/a");
      return (
        <BrandingContext.Provider value={marca({})}>
          <button onClick={() => setChave("/b")}>ir</button>
          <ErrorBoundary resetKey={chave}>{chave === "/a" ? <Quebrado /> : <p>outra tela</p>}</ErrorBoundary>
        </BrandingContext.Provider>
      );
    }
    render(<Teste />);
    expect(screen.getByText("Algo deu errado")).toBeTruthy();

    fireEvent.click(screen.getByText("ir"));

    expect(screen.getByText("outra tela")).toBeTruthy();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });
});

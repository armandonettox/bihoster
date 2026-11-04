import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FullscreenHeader from "./FullscreenHeader";

const mocks = vi.hoisted(() => ({
  settings: null as { logo_url?: string | null; company_name?: string } | null,
}));

vi.mock("../context/BrandingContext", () => ({ useBranding: () => ({ settings: mocks.settings }) }));
vi.mock("../api/client", () => ({ assetUrl: (url: string) => `https://arquivos.exemplo${url}` }));

beforeEach(() => {
  mocks.settings = null;
});

describe("FullscreenHeader - marca", () => {
  it("usa a logo enviada em Configuracoes quando existe", () => {
    mocks.settings = { logo_url: "/uploads/logo.png", company_name: "Empresa Teste" };
    render(<FullscreenHeader title="Vendas" />);

    const logo = screen.getByRole("img", { name: "Empresa Teste" }) as HTMLImageElement;
    expect(logo.src).toBe("https://arquivos.exemplo/uploads/logo.png");
  });

  it("sem logo enviada mostra a logo padrao do BIHoster", () => {
    render(<FullscreenHeader title="Vendas" />);

    expect(screen.getAllByRole("img", { name: "BIHoster" }).length).toBeGreaterThan(0);
  });

  it("o nome do relatorio fica como dica da logo, nao escrito, no relatorio avulso", () => {
    const { container } = render(<FullscreenHeader title="Vendas e Inclusoes" />);

    expect(container.querySelector(".fullscreen-header-brand")?.getAttribute("title")).toBe("Vendas e Inclusoes");
    expect(screen.queryByText("Vendas e Inclusoes")).toBeNull();
  });

  it("onde o conteudo troca sozinho o nome fica escrito ao lado da logo", () => {
    render(<FullscreenHeader title="Painel da Loja" showTitle />);

    expect(screen.getByText("Painel da Loja")).toBeTruthy();
  });
});

describe("FullscreenHeader - botao de sair", () => {
  it("mostra icone, a palavra Sair e a tecla Esc, com nome acessivel", () => {
    render(<FullscreenHeader title="Vendas" onExit={vi.fn()} />);

    const botao = screen.getByRole("button", { name: "Sair da tela cheia (Esc)" });
    expect(botao.textContent).toContain("close");
    expect(botao.textContent).toContain("Sair");
    expect(botao.querySelector("kbd")?.textContent).toBe("Esc");
    expect(botao.getAttribute("title")).toBe("Sair da tela cheia (Esc)");
  });

  it("clicar chama onExit", () => {
    const sair = vi.fn();
    render(<FullscreenHeader title="Vendas" onExit={sair} />);

    fireEvent.click(screen.getByRole("button", { name: /Sair da tela cheia/ }));

    expect(sair).toHaveBeenCalledTimes(1);
  });

  it("sem onExit nao ha botao (pagina da TV, aberta numa aba propria)", () => {
    render(<FullscreenHeader title="Vendas" />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("FullscreenHeader - faixa de acoes e controles", () => {
  it("sem acoes a faixa nem existe: nao ocupa espaco nem mostra nada", () => {
    render(<FullscreenHeader title="Vendas" onExit={vi.fn()} />);

    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("com acoes mostra uma barra de ferramentas com elas", () => {
    render(
      <FullscreenHeader
        title="Vendas"
        actions={
          <>
            <button>Assinar</button>
            <button>Comentarios</button>
          </>
        }
      />,
    );

    const barra = screen.getByRole("toolbar", { name: "Acoes do relatorio" });
    expect(barra.textContent).toContain("Assinar");
    expect(barra.textContent).toContain("Comentarios");
  });

  it("mostra os controles ao lado do botao de sair (setas da Apresentacao)", () => {
    render(<FullscreenHeader title="Vendas" onExit={vi.fn()} controls={<button>proximo</button>} />);

    expect(screen.getByRole("button", { name: "proximo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sair da tela cheia/ })).toBeTruthy();
  });
});

import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";

// A interface é toda em português. Se a página se declarar em inglês (lang="en"), o navegador oferece traduzir, e
// traduzir quebra a tela: os ícones são texto em inglês (home, dark_mode...) trocado por uma fonte de ícones.
describe("index.html - idioma e tradução do navegador", () => {
  const html = new DOMParser().parseFromString(indexHtml, "text/html");

  it("declara a página em português do Brasil", () => {
    expect(html.documentElement.getAttribute("lang")).toBe("pt-BR");
  });

  it("pede ao navegador para não traduzir a página", () => {
    expect(html.documentElement.getAttribute("translate")).toBe("no");
    expect(html.querySelector('meta[name="google"]')?.getAttribute("content")).toBe("notranslate");
  });

  it("não declara inglês em nenhum lugar do documento", () => {
    expect(html.querySelectorAll('[lang="en"], [lang^="en-"]')).toHaveLength(0);
  });
});

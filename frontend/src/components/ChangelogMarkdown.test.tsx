import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ChangelogMarkdown from "./ChangelogMarkdown";

describe("ChangelogMarkdown", () => {
  it("lista com hífen vira lista, e linhas seguidas viram um parágrafo só", () => {
    render(<ChangelogMarkdown text={"Primeira linha\nsegue na mesma.\n\n- um\n- dois"} />);

    expect(screen.getByText("Primeira linha segue na mesma.")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["um", "dois"]);
  });

  it("título com ### vira cabeçalho", () => {
    render(<ChangelogMarkdown text={"### Novidades\n- algo"} />);

    expect(screen.getByRole("heading", { name: "Novidades" })).toBeTruthy();
  });

  it("negrito e código aparecem no meio do texto", () => {
    render(<ChangelogMarkdown text={"- use **isto** e `aquilo` agora"} />);

    expect(screen.getByText("isto").tagName).toBe("STRONG");
    expect(screen.getByText("aquilo").tagName).toBe("CODE");
  });

  it("link http abre em outra aba sem passar a janela de origem", () => {
    render(<ChangelogMarkdown text={"- veja [o projeto](https://github.com/armandonettox/bihoster)"} />);

    const link = screen.getByRole("link", { name: "o projeto" });
    expect(link.getAttribute("href")).toBe("https://github.com/armandonettox/bihoster");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("link que não é http vira só o texto", () => {
    render(<ChangelogMarkdown text={"- [clique](javascript:alert(1))"} />);

    expect(screen.queryByRole("link")).toBeNull();
    // O endereco com parenteses solta um ")" no fim, mas nada vira link
    expect(screen.getByRole("listitem").textContent).toMatch(/^clique/);
  });

  it("HTML cru aparece como texto e nunca é interpretado", () => {
    const { container } = render(<ChangelogMarkdown text={'- <script>alert(1)</script> e <img src=x onerror=alert(1)>'} />);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("imagem do histórico carrega do próprio sistema como miniatura e abre ampliada ao clicar", () => {
    const { container } = render(<ChangelogMarkdown text={"![Aba E-mail](img/aba-email.png)"} />);

    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toMatch(/\/static\/changelog\/aba-email\.png$/);
    expect(img.getAttribute("alt")).toBe("Aba E-mail");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.className).toBe("changelog-image");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ampliar imagem: Aba E-mail" }));

    const janela = screen.getByRole("dialog");
    const ampliada = janela.querySelector("img") as HTMLImageElement;
    expect(ampliada.getAttribute("src")).toBe(img.getAttribute("src"));
    const abrir = screen.getByRole("link", { name: "Abrir em outra aba" });
    expect(abrir.getAttribute("href")).toBe(img.getAttribute("src"));
    expect(abrir.getAttribute("target")).toBe("_blank");
  });

  it("a janela ampliada fecha pelo botão, pelo Esc e pelo clique fora da imagem", () => {
    render(<ChangelogMarkdown text={"![Tela](img/tela.png)"} />);
    const abrir = () => fireEvent.click(screen.getByRole("button", { name: "Ampliar imagem: Tela" }));

    abrir();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    abrir();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    abrir();
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();

    // Clicar na própria imagem ampliada não fecha
    abrir();
    fireEvent.click(screen.getByRole("dialog").querySelector("img") as HTMLImageElement);
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it.each([
    ["passeio-pelo-sistema.gif", "Passeio pelo sistema"],
    ["tela.jpg", "Tela"],
  ])("GIF e JPG do histórico (%s) carregam do próprio sistema como qualquer imagem", (arquivo, descricao) => {
    const { container } = render(<ChangelogMarkdown text={`![${descricao}](img/${arquivo})`} />);

    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toMatch(new RegExp(`/static/changelog/${arquivo.replace(".", "\\.")}$`));
    expect(img.getAttribute("alt")).toBe(descricao);
    expect(img.closest("button")).not.toBeNull();
  });

  it.each([
    "![x](https://exemplo.com/foto.png)",
    "![x](//exemplo.com/foto.png)",
    "![x](img/../segredo.png)",
    "![x](img/sub/pasta.png)",
    "![x](/static/uploads/logo.png)",
    "![x](javascript:alert(1))",
  ])("imagem de fora do histórico (%s) não carrega nada e fica só a descrição", (text) => {
    const { container } = render(<ChangelogMarkdown text={text} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toMatch(/^x/);
  });

  it("texto vazio não desenha nada", () => {
    const { container } = render(<ChangelogMarkdown text={""} />);

    expect(container.querySelector(".changelog")?.children).toHaveLength(0);
  });
});

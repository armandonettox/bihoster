import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BrandLogo from "./BrandLogo";

describe("BrandLogo", () => {
  it("sem logo da marca mostra a logo padrão", () => {
    const { container } = render(<BrandLogo logoUrl={null} className="x" />);

    expect(container.querySelector("img[alt='Logo']")).toBeNull();
    expect(container.querySelector(".x")).not.toBeNull();
  });

  it("com logo da marca mostra a imagem", () => {
    const { container } = render(<BrandLogo logoUrl="/a.png" className="x" />);

    expect(container.querySelector("img.x")?.getAttribute("src")).toBe("/a.png");
  });

  it("se a imagem falhar cai na logo padrão, e uma logo nova tem outra chance", () => {
    const { container, rerender } = render(<BrandLogo logoUrl="/a.png" className="x" />);

    fireEvent.error(container.querySelector("img.x") as HTMLImageElement);
    expect(container.querySelector("img[src='/a.png']")).toBeNull();
    expect(container.querySelector(".x")).not.toBeNull();

    rerender(<BrandLogo logoUrl="/b.png" className="x" />);
    expect(container.querySelector("img.x")?.getAttribute("src")).toBe("/b.png");
  });
});

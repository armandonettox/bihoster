import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatNavLink from "./ChatNavLink";

const mocks = vi.hoisted(() => ({ canUse: true, panelOpen: false, setPanelOpen: vi.fn() }));

vi.mock("../context/ChatContext", () => ({
  useChat: () => ({ canUse: mocks.canUse, panelOpen: mocks.panelOpen, setPanelOpen: mocks.setPanelOpen }),
}));

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ChatNavLink />
    </MemoryRouter>,
  );

const item = () => screen.getByRole("button", { name: /Chat de IA/ });

beforeEach(() => {
  mocks.canUse = true;
  mocks.panelOpen = false;
  mocks.setPanelOpen.mockReset();
});

describe("ChatNavLink", () => {
  it("quem pode usar o chat ve o item, que abre o painel lateral e nao a pagina /chat", () => {
    renderAt("/");

    expect(screen.queryByRole("link", { name: /Chat de IA/ })).toBeNull();
    fireEvent.click(item());

    expect(mocks.setPanelOpen).toHaveBeenCalledWith(true);
  });

  it("com o painel aberto, o clique fecha", () => {
    mocks.panelOpen = true;
    renderAt("/collection");

    fireEvent.click(item());

    expect(mocks.setPanelOpen).toHaveBeenCalledWith(false);
  });

  it("quem nao pode usar nao ve nada", () => {
    mocks.canUse = false;
    renderAt("/");

    expect(screen.queryByRole("button", { name: /Chat de IA/ })).toBeNull();
  });

  it("fica ativo com o painel aberto", () => {
    mocks.panelOpen = true;
    renderAt("/settings");

    expect(item().className).toContain("sidebar-home-link-active");
    expect(item().getAttribute("aria-pressed")).toBe("true");
  });

  it("fica ativo dentro de /chat e o clique la nao faz nada", () => {
    renderAt("/chat");

    expect(item().className).toContain("sidebar-home-link-active");
    fireEvent.click(item());
    expect(mocks.setPanelOpen).not.toHaveBeenCalled();
  });

  it("nao fica ativo em outras telas com o painel fechado", () => {
    renderAt("/settings");

    expect(item().className).not.toContain("sidebar-home-link-active");
  });
});

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatNavLink from "./ChatNavLink";

const mocks = vi.hoisted(() => ({ canUse: true }));

vi.mock("../hooks/useAiAccess", () => ({
  useAiAccess: () => ({ canManage: false, canUse: mocks.canUse, loading: false }),
}));

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ChatNavLink />
    </MemoryRouter>,
  );

beforeEach(() => {
  mocks.canUse = true;
});

describe("ChatNavLink", () => {
  it("quem pode usar o chat ve o item, que leva para /chat", () => {
    renderAt("/");

    expect(screen.getByRole("link", { name: /Chat de IA/ }).getAttribute("href")).toBe("/chat");
  });

  it("quem nao pode usar nao ve nada", () => {
    mocks.canUse = false;
    renderAt("/");

    expect(screen.queryByRole("link", { name: /Chat de IA/ })).toBeNull();
  });

  it("marca o item como ativo dentro de /chat", () => {
    renderAt("/chat");

    expect(screen.getByRole("link", { name: /Chat de IA/ }).className).toContain("sidebar-home-link-active");
  });

  it("nao marca como ativo em outras telas", () => {
    renderAt("/settings");

    expect(screen.getByRole("link", { name: /Chat de IA/ }).className).not.toContain("sidebar-home-link-active");
  });
});

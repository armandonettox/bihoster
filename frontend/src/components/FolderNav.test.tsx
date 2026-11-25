import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode, Workspace } from "../api/workspaces";
import FolderNav from "./FolderNav";

const mocks = vi.hoisted(() => ({
  getWorkspaceTree: vi.fn(),
  selectWorkspace: vi.fn(),
  current: null as Workspace | null,
  workspaces: [] as Workspace[],
}));

vi.mock("../api/workspaces", () => ({ getWorkspaceTree: mocks.getWorkspaceTree }));
vi.mock("../context/WorkspaceContext", () => ({
  useWorkspace: () => ({ workspaces: mocks.workspaces, currentWorkspace: mocks.current, selectWorkspace: mocks.selectWorkspace }),
}));

function ws(id: number, name: string, parent: number | null): Workspace {
  return { id, name, slug: name.toLowerCase(), description: null, icon: null, color: null, parent_id: parent, role: "viewer" };
}

function node(id: number, name: string, parent: number | null, accessible: boolean): TreeNode {
  return { id, name, slug: name.toLowerCase(), icon: null, color: null, parent_id: parent, accessible };
}

beforeEach(() => {
  mocks.getWorkspaceTree.mockReset();
  mocks.selectWorkspace.mockReset();
});

describe("FolderNav", () => {
  it("numa colecao solta nao mostra nada", async () => {
    mocks.workspaces = [ws(1, "Comercial", null)];
    mocks.current = mocks.workspaces[0];
    mocks.getWorkspaceTree.mockResolvedValue([node(1, "Comercial", null, true)]);

    const { container } = render(<FolderNav />);

    await vi.waitFor(() => expect(mocks.getWorkspaceTree).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("mostra as subpastas que a pessoa acessa e abre uma ao clicar", async () => {
    mocks.workspaces = [ws(1, "Financeiro", null), ws(2, "Faturamento", 1), ws(3, "Custos", 1)];
    mocks.current = mocks.workspaces[0];
    mocks.getWorkspaceTree.mockResolvedValue([]);

    render(<FolderNav />);
    fireEvent.click(await screen.findByRole("button", { name: /Faturamento/ }));

    expect(mocks.selectWorkspace).toHaveBeenCalledWith(2);
    expect(screen.getByText("Pastas dentro desta")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Custos/ })).toBeTruthy();
  });

  it("o caminho mostra a pasta de cima so como nome quando a pessoa nao a acessa", async () => {
    mocks.workspaces = [ws(2, "Faturamento", 1)];
    mocks.current = mocks.workspaces[0];
    mocks.getWorkspaceTree.mockResolvedValue([node(1, "Financeiro", null, false), node(2, "Faturamento", 1, true)]);

    render(<FolderNav />);

    const caminho = await screen.findByRole("navigation", { name: "Caminho das pastas" });
    expect(caminho.textContent).toContain("Financeiro");
    expect(screen.queryByRole("button", { name: "Financeiro" })).toBeNull();
    expect(screen.getByText("Faturamento").getAttribute("aria-current")).toBe("page");
  });

  it("a pasta de cima que a pessoa acessa vira um botao no caminho", async () => {
    mocks.workspaces = [ws(1, "Financeiro", null), ws(2, "Faturamento", 1)];
    mocks.current = mocks.workspaces[1];
    mocks.getWorkspaceTree.mockResolvedValue([node(1, "Financeiro", null, true), node(2, "Faturamento", 1, true)]);

    render(<FolderNav />);
    fireEvent.click(await screen.findByRole("button", { name: "Financeiro" }));

    expect(mocks.selectWorkspace).toHaveBeenCalledWith(1);
  });

  it("se a arvore falhar, as subpastas continuam aparecendo", async () => {
    mocks.workspaces = [ws(1, "Financeiro", null), ws(2, "Faturamento", 1)];
    mocks.current = mocks.workspaces[0];
    mocks.getWorkspaceTree.mockRejectedValue(new Error("falhou"));

    render(<FolderNav />);

    expect(await screen.findByRole("button", { name: /Faturamento/ })).toBeTruthy();
  });
});

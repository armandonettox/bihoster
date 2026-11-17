import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as workspacesApi from "../../api/workspaces";
import CollectionsTab from "./CollectionsTab";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  reload: vi.fn(),
  loading: false,
  workspaces: [] as unknown[],
}));

vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../context/WorkspaceContext", () => ({
  useWorkspace: () => ({ workspaces: mocks.workspaces, loading: mocks.loading, reload: mocks.reload }),
}));
vi.mock("../../api/workspaces", () => ({ deleteWorkspace: vi.fn() }));
// A janela de editar tem teste próprio: aqui só importa quando abre e com que propriedades
vi.mock("../../components/EditCollectionModal", () => ({
  default: ({ workspace, manageAccess, onClose }: { workspace: { name: string }; manageAccess?: boolean; onClose: () => void }) => (
    <div role="dialog" aria-label="janela de editar">
      <span>editando {workspace.name}</span>
      <span>{manageAccess ? "com acesso dos grupos" : "sem acesso dos grupos"}</span>
      <button onClick={onClose}>fechar janela</button>
    </div>
  ),
}));

const deleteWorkspace = vi.mocked(workspacesApi.deleteWorkspace);

const COLECOES = [
  { id: 1, name: "Comercial", description: "Vendas do mês", icon: null, color: null },
  { id: 2, name: "Saúde", description: null, icon: null, color: null },
];

const linha = (nome: string) => screen.getByText(nome).closest(".collection-row") as HTMLElement;
const abrirMenu = (nome: string) => fireEvent.click(within(linha(nome)).getByLabelText("Mais opcoes"));

beforeEach(() => {
  mocks.showToast.mockClear();
  mocks.reload.mockClear();
  mocks.loading = false;
  mocks.workspaces = COLECOES;
  deleteWorkspace.mockReset();
  deleteWorkspace.mockResolvedValue(undefined as never);
});

describe("CollectionsTab - lista", () => {
  it("mostra cada coleção com nome e descrição, sem a tabela de grupos no cartão", () => {
    render(<CollectionsTab />);

    expect(screen.getByText("Comercial")).toBeTruthy();
    expect(screen.getByText("Vendas do mês")).toBeTruthy();
    expect(screen.getByText("Saúde")).toBeTruthy();
    expect(screen.queryByText("Acesso por grupo")).toBeNull();
    expect(screen.queryByText("▸")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("coleção sem descrição não mostra linha de descrição", () => {
    render(<CollectionsTab />);

    expect(linha("Saúde").querySelector(".collection-row-desc")).toBeNull();
    expect(linha("Comercial").querySelector(".collection-row-desc")).not.toBeNull();
  });

  it("enquanto carrega não mostra as coleções", () => {
    mocks.loading = true;
    render(<CollectionsTab />);

    expect(screen.queryByText("Comercial")).toBeNull();
  });

  it("o texto de ajuda manda abrir o menu e escolher Editar para mudar o acesso", () => {
    render(<CollectionsTab />);

    expect(screen.getByText(/abra o menu da coleção e escolha Editar/)).toBeTruthy();
  });
});

describe("CollectionsTab - menu dos 3 pontinhos", () => {
  const icone = (botao: HTMLElement) => botao.querySelector(".material-symbols-outlined");

  it("Editar e Excluir têm ícone, escondido do leitor de tela", () => {
    render(<CollectionsTab />);
    abrirMenu("Comercial");

    const editar = screen.getByRole("button", { name: "Editar" });
    const excluir = screen.getByRole("button", { name: "Excluir" });
    expect(icone(editar)?.textContent).toBe("edit");
    expect(icone(excluir)?.textContent).toBe("delete");
    expect(icone(editar)?.getAttribute("aria-hidden")).toBe("true");
    expect(icone(excluir)?.getAttribute("aria-hidden")).toBe("true");
  });

  it("Excluir continua em vermelho e as opções usam o layout com ícone", () => {
    render(<CollectionsTab />);
    abrirMenu("Comercial");

    const editar = screen.getByRole("button", { name: "Editar" });
    const excluir = screen.getByRole("button", { name: "Excluir" });
    expect(editar.className).toContain("kebab-menu-item-with-icon");
    expect(excluir.className).toContain("kebab-menu-item-with-icon");
    expect(excluir.className).toContain("kebab-menu-item-danger");
    expect(editar.className).not.toContain("kebab-menu-item-danger");
  });

  it("Editar abre a janela da coleção certa, com o acesso dos grupos ligado, e fecha o menu", () => {
    render(<CollectionsTab />);
    abrirMenu("Saúde");

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByText("editando Saúde")).toBeTruthy();
    expect(screen.getByText("com acesso dos grupos")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
  });

  it("fechar a janela de editar volta para a lista", () => {
    render(<CollectionsTab />);
    abrirMenu("Comercial");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    fireEvent.click(screen.getByText("fechar janela"));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("CollectionsTab - excluir", () => {
  it("Excluir pede confirmação, com ícones, e ainda não exclui", () => {
    render(<CollectionsTab />);
    abrirMenu("Comercial");

    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    const confirmar = screen.getByRole("button", { name: "Confirmar exclusão" });
    expect(confirmar.querySelector(".material-symbols-outlined")?.textContent).toBe("delete_forever");
    expect(screen.getByRole("button", { name: "Cancelar" }).querySelector(".material-symbols-outlined")?.textContent).toBe("close");
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });

  it("Cancelar volta para Editar e Excluir sem excluir", () => {
    render(<CollectionsTab />);
    abrirMenu("Comercial");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });

  it("Confirmar exclusão exclui a coleção certa, recarrega a lista e avisa", async () => {
    render(<CollectionsTab />);
    abrirMenu("Saúde");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    await waitFor(() => expect(deleteWorkspace).toHaveBeenCalledWith(2));
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
    expect(mocks.showToast).toHaveBeenCalledWith("Coleção excluída.");
  });

  it("falha ao excluir avisa o erro do servidor e não recarrega", async () => {
    deleteWorkspace.mockRejectedValue({ response: { data: { detail: "A coleção tem relatórios" } } });
    render(<CollectionsTab />);
    abrirMenu("Comercial");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("A coleção tem relatórios", "error"));
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it("falha sem mensagem do servidor mostra um aviso padrão", async () => {
    deleteWorkspace.mockRejectedValue(new Error("rede"));
    render(<CollectionsTab />);
    abrirMenu("Comercial");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Não foi possível excluir a coleção.", "error"));
  });

  it("fechar o menu no meio da confirmação volta ao estado inicial", () => {
    render(<CollectionsTab />);
    abrirMenu("Comercial");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    fireEvent.keyDown(document, { key: "Escape" });
    abrirMenu("Comercial");

    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirmar exclusão" })).toBeNull();
  });
});

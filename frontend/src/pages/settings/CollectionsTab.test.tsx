import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../../api/access";
import * as workspacesApi from "../../api/workspaces";
import { AccessContext, buildAccess } from "../../context/AccessContext";
import CollectionsTab from "./CollectionsTab";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  reload: vi.fn(),
  // O que a pessoa tem em cada colecao (id -> permissoes) e no sistema todo
  permissoes: {} as Record<string, string[]>,
  globais: [] as string[],
}));

vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../context/WorkspaceContext", () => ({
  useWorkspace: () => ({ reload: mocks.reload }),
}));
vi.mock("../../api/workspaces", () => ({ deleteWorkspace: vi.fn(), listAllWorkspaces: vi.fn() }));
// A janela de editar tem teste próprio: aqui só importa quando abre e para qual coleção
vi.mock("../../components/EditCollectionModal", () => ({
  default: ({ workspace, onClose }: { workspace: { name: string }; onClose: () => void }) => (
    <div role="dialog" aria-label="janela de editar">
      <span>editando {workspace.name}</span>
      <button onClick={onClose}>fechar janela</button>
    </div>
  ),
}));

const deleteWorkspace = vi.mocked(workspacesApi.deleteWorkspace);
const listAllWorkspaces = vi.mocked(workspacesApi.listAllWorkspaces);

const EDITAR_E_EXCLUIR = ["colecao.ver", "colecao.editar", "colecao.excluir"];

/** A aba com o acesso montado: por padrao a pessoa edita e exclui as duas colecoes */
async function abrir() {
  const me: MyAccess = { is_admin: false, global_permissions: mocks.globais, workspace_permissions: mocks.permissoes };
  const utils = render(
    <AccessContext.Provider value={buildAccess(me)}>
      <CollectionsTab />
    </AccessContext.Provider>,
  );
  await screen.findByText("Comercial");
  return utils;
}

const COLECOES = [
  { id: 1, name: "Comercial", description: "Vendas do mês", icon: null, color: null },
  { id: 2, name: "Saúde", description: null, icon: null, color: null },
];

const linha = (nome: string) => screen.getByText(nome).closest(".collection-row") as HTMLElement;
const abrirMenu = (nome: string) => fireEvent.click(within(linha(nome)).getByLabelText("Mais opcoes"));

beforeEach(() => {
  mocks.showToast.mockClear();
  mocks.reload.mockClear();
  mocks.permissoes = { "1": EDITAR_E_EXCLUIR, "2": EDITAR_E_EXCLUIR };
  mocks.globais = ["colecao.todas"];
  listAllWorkspaces.mockReset();
  listAllWorkspaces.mockResolvedValue(COLECOES as never);
  deleteWorkspace.mockReset();
  deleteWorkspace.mockResolvedValue(undefined as never);
});

describe("CollectionsTab - lista", () => {
  it("mostra cada coleção com nome e descrição, sem a tabela de grupos no cartão", async () => {
    await abrir();

    expect(screen.getByText("Comercial")).toBeTruthy();
    expect(screen.getByText("Vendas do mês")).toBeTruthy();
    expect(screen.getByText("Saúde")).toBeTruthy();
    expect(screen.queryByText("Acesso por grupo")).toBeNull();
    expect(screen.queryByText("▸")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("coleção sem descrição não mostra linha de descrição", async () => {
    await abrir();

    expect(linha("Saúde").querySelector(".collection-row-desc")).toBeNull();
    expect(linha("Comercial").querySelector(".collection-row-desc")).not.toBeNull();
  });

  it("enquanto carrega não mostra as coleções", async () => {
    listAllWorkspaces.mockReturnValue(new Promise(() => {}));
    render(
      <AccessContext.Provider value={buildAccess({ is_admin: true, global_permissions: [], workspace_permissions: {} })}>
        <CollectionsTab />
      </AccessContext.Provider>,
    );

    expect(screen.queryByText("Comercial")).toBeNull();
  });

  it("mostra todas as coleções do sistema, mesmo as que a pessoa não acessa", async () => {
    mocks.permissoes = {};
    await abrir();

    expect(listAllWorkspaces).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saúde")).toBeTruthy();
  });

  it("o texto de ajuda manda escolher o acesso em Gerenciar usuários", async () => {
    await abrir();

    expect(screen.getByText("Gerenciar usuários")).toBeTruthy();
    expect(screen.queryByText(/abra o menu da coleção e escolha Editar/)).toBeNull();
  });
});

describe("CollectionsTab - menu dos 3 pontinhos", () => {
  const icone = (botao: HTMLElement) => botao.querySelector(".material-symbols-outlined");

  it("Editar e Excluir têm ícone, escondido do leitor de tela", async () => {
    await abrir();
    abrirMenu("Comercial");

    const editar = screen.getByRole("button", { name: "Editar" });
    const excluir = screen.getByRole("button", { name: "Excluir" });
    expect(icone(editar)?.textContent).toBe("edit");
    expect(icone(excluir)?.textContent).toBe("delete");
    expect(icone(editar)?.getAttribute("aria-hidden")).toBe("true");
    expect(icone(excluir)?.getAttribute("aria-hidden")).toBe("true");
  });

  it("Excluir continua em vermelho e as opções usam o layout com ícone", async () => {
    await abrir();
    abrirMenu("Comercial");

    const editar = screen.getByRole("button", { name: "Editar" });
    const excluir = screen.getByRole("button", { name: "Excluir" });
    expect(editar.className).toContain("kebab-menu-item-with-icon");
    expect(excluir.className).toContain("kebab-menu-item-with-icon");
    expect(excluir.className).toContain("kebab-menu-item-danger");
    expect(editar.className).not.toContain("kebab-menu-item-danger");
  });

  it("Editar abre a janela da coleção certa e fecha o menu", async () => {
    await abrir();
    abrirMenu("Saúde");

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByText("editando Saúde")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
  });

  it("fechar a janela de editar volta para a lista", async () => {
    await abrir();
    abrirMenu("Comercial");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    fireEvent.click(screen.getByText("fechar janela"));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("CollectionsTab - excluir", () => {
  it("Excluir pede confirmação, com ícones, e ainda não exclui", async () => {
    await abrir();
    abrirMenu("Comercial");

    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    const confirmar = screen.getByRole("button", { name: "Confirmar exclusão" });
    expect(confirmar.querySelector(".material-symbols-outlined")?.textContent).toBe("delete_forever");
    expect(screen.getByRole("button", { name: "Cancelar" }).querySelector(".material-symbols-outlined")?.textContent).toBe("close");
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });

  it("Cancelar volta para Editar e Excluir sem excluir", async () => {
    await abrir();
    abrirMenu("Comercial");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });

  it("Confirmar exclusão exclui a coleção certa, recarrega a lista e avisa", async () => {
    await abrir();
    abrirMenu("Saúde");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    await waitFor(() => expect(deleteWorkspace).toHaveBeenCalledWith(2));
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
    expect(mocks.showToast).toHaveBeenCalledWith("Coleção excluída.");
  });

  it("falha ao excluir avisa o erro do servidor e não recarrega", async () => {
    deleteWorkspace.mockRejectedValue({ response: { data: { detail: "A coleção tem relatórios" } } });
    await abrir();
    abrirMenu("Comercial");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("A coleção tem relatórios", "error"));
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it("falha sem mensagem do servidor mostra um aviso padrão", async () => {
    deleteWorkspace.mockRejectedValue(new Error("rede"));
    await abrir();
    abrirMenu("Comercial");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Não foi possível excluir a coleção.", "error"));
  });

  it("fechar o menu no meio da confirmação volta ao estado inicial", async () => {
    await abrir();
    abrirMenu("Comercial");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    fireEvent.keyDown(document, { key: "Escape" });
    abrirMenu("Comercial");

    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirmar exclusão" })).toBeNull();
  });
});


describe("CollectionsTab - cada acao pela sua permissao na coleção", () => {
  it("só editar mostra Editar, sem Excluir", async () => {
    mocks.permissoes = { "1": ["colecao.ver", "colecao.editar"], "2": ["colecao.ver", "colecao.editar"] };
    await abrir();
    abrirMenu("Comercial");

    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
  });

  it("só excluir mostra Excluir, sem Editar", async () => {
    mocks.permissoes = { "1": ["colecao.ver", "colecao.excluir"], "2": ["colecao.ver", "colecao.excluir"] };
    await abrir();
    abrirMenu("Comercial");

    expect(screen.getByRole("button", { name: "Excluir" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });

  it("sem editar nem excluir a linha não tem menu de três pontinhos", async () => {
    mocks.permissoes = { "1": ["colecao.ver"], "2": ["colecao.ver"] };
    await abrir();

    expect(within(linha("Comercial")).queryByLabelText("Mais opcoes")).toBeNull();
  });

  it("a permissão vale só na coleção em que foi dada", async () => {
    mocks.permissoes = { "1": EDITAR_E_EXCLUIR, "2": ["colecao.ver"] };
    await abrir();

    expect(within(linha("Comercial")).queryByLabelText("Mais opcoes")).not.toBeNull();
    expect(within(linha("Saúde")).queryByLabelText("Mais opcoes")).toBeNull();
  });
});

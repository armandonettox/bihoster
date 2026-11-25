import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as workspacesApi from "../api/workspaces";
import NewCollectionModal from "./NewCollectionModal";

const mocks = vi.hoisted(() => ({ showToast: vi.fn(), reloadAndSelect: vi.fn() }));

vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../context/WorkspaceContext", () => ({ useWorkspace: () => ({ reloadAndSelect: mocks.reloadAndSelect, workspaces: [] }) }));
// O campo "Dentro de" tem teste proprio (ParentFolderSelect.test.tsx)
vi.mock("./ParentFolderSelect", () => ({ default: () => null }));
vi.mock("./CollectionIconPicker", () => ({ default: () => null }));
vi.mock("../api/workspaces", () => ({ createWorkspace: vi.fn() }));

const createWorkspace = vi.mocked(workspacesApi.createWorkspace);
const onClose = vi.fn();

function abrir() {
  render(
    <MemoryRouter>
      <NewCollectionModal onClose={onClose} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.showToast.mockClear();
  mocks.reloadAndSelect.mockReset().mockResolvedValue(undefined);
  onClose.mockClear();
  createWorkspace.mockReset().mockResolvedValue({ id: 12 } as never);
});

describe("NewCollectionModal", () => {
  it("nao tem mais a matriz de acesso por grupo: so a caixa de visibilidade, ligada por padrao", () => {
    abrir();

    expect(screen.queryByText("Acesso por grupo")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect((screen.getByLabelText("Todas as pessoas podem ver esta coleção") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Gerenciar usuários")).toBeTruthy();
  });

  it("criar com a caixa ligada manda a colecao visivel para todos", async () => {
    abrir();

    fireEvent.change(screen.getByPlaceholderText("Nome da coleção"), { target: { value: "Vendas" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() =>
      expect(createWorkspace).toHaveBeenCalledWith({ name: "Vendas", description: null, icon: null, color: null, everyone_can_view: true }),
    );
    await waitFor(() => expect(mocks.reloadAndSelect).toHaveBeenCalledWith(12));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("Coleção criada.");
  });

  it("desmarcar a caixa cria uma colecao privada", async () => {
    abrir();

    fireEvent.change(screen.getByPlaceholderText("Nome da coleção"), { target: { value: "Diretoria" } });
    fireEvent.click(screen.getByLabelText("Todas as pessoas podem ver esta coleção"));
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() => expect(createWorkspace).toHaveBeenCalledWith(expect.objectContaining({ everyone_can_view: false })));
  });

  it("falha ao criar mostra o erro e nao fecha", async () => {
    createWorkspace.mockRejectedValue({ response: { data: { detail: "Nome já usado" } } });
    abrir();

    fireEvent.change(screen.getByPlaceholderText("Nome da coleção"), { target: { value: "Vendas" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    expect(await screen.findByText("Nome já usado")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

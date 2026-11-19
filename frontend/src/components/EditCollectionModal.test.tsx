import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as workspacesApi from "../api/workspaces";
import type { Workspace } from "../api/workspaces";
import EditCollectionModal from "./EditCollectionModal";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("./CollectionIconPicker", () => ({ default: () => null }));
vi.mock("../api/workspaces", () => ({ updateWorkspace: vi.fn() }));

const updateWorkspace = vi.mocked(workspacesApi.updateWorkspace);

const COLECAO = {
  id: 7,
  name: "Comercial",
  slug: "comercial",
  description: "Vendas do mês",
  icon: null,
  color: null,
  tv_interval_seconds: 30,
  role: "admin",
} as unknown as Workspace;

const onSaved = vi.fn();
const onClose = vi.fn();

const salvar = () => screen.getByText("Salvar") as HTMLButtonElement;

function abrir() {
  render(<EditCollectionModal workspace={COLECAO} onSaved={onSaved} onClose={onClose} />);
}

beforeEach(() => {
  mocks.showToast.mockClear();
  onSaved.mockClear();
  onClose.mockClear();
  updateWorkspace.mockReset();
  updateWorkspace.mockResolvedValue(COLECAO);
});

describe("EditCollectionModal", () => {
  it("mostra os dados da coleção e manda escolher o acesso em Gerenciar usuários, sem matriz de grupos", () => {
    abrir();

    expect(screen.getByText("Editar coleção")).toBeTruthy();
    expect((screen.getByLabelText("Nome da coleção") as HTMLInputElement).value).toBe("Comercial");
    expect((screen.getByLabelText("Descrição da coleção") as HTMLTextAreaElement).value).toBe("Vendas do mês");
    expect(screen.getByText("Gerenciar usuários")).toBeTruthy();
    expect(screen.queryByText("Acesso por grupo")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("salva os dados da coleção, avisa e fecha", async () => {
    abrir();

    fireEvent.change(screen.getByLabelText("Nome da coleção"), { target: { value: "Comercial 2" } });
    fireEvent.click(salvar());

    await waitFor(() =>
      expect(updateWorkspace).toHaveBeenCalledWith(7, { name: "Comercial 2", description: "Vendas do mês", icon: null, color: null }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("Coleção atualizada.");
  });

  it("descrição vazia vai como nulo", async () => {
    abrir();

    fireEvent.change(screen.getByLabelText("Descrição da coleção"), { target: { value: "" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(updateWorkspace).toHaveBeenCalledWith(7, expect.objectContaining({ description: null })));
  });

  it("falha ao salvar avisa o erro do servidor, não fecha e não chama onSaved", async () => {
    updateWorkspace.mockRejectedValue({ response: { data: { detail: "Nome já usado" } } });
    abrir();

    fireEvent.click(salvar());

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Nome já usado");
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("Cancelar fecha sem gravar nada", () => {
    abrir();

    fireEvent.click(screen.getByText("Cancelar"));

    expect(onClose).toHaveBeenCalled();
    expect(updateWorkspace).not.toHaveBeenCalled();
  });

  it("enquanto grava mostra Salvando e desliga o botão", async () => {
    let resolver: () => void = () => undefined;
    updateWorkspace.mockReturnValue(new Promise((resolve) => (resolver = () => resolve(COLECAO))));
    abrir();

    fireEvent.click(salvar());

    const botao = await screen.findByText("Salvando...");
    expect((botao as HTMLButtonElement).disabled).toBe(true);
    resolver();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

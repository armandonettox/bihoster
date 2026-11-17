import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as workspacesApi from "../api/workspaces";
import type { AccessEntry, Workspace } from "../api/workspaces";
import EditCollectionModal from "./EditCollectionModal";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("./CollectionIconPicker", () => ({ default: () => null }));
vi.mock("../api/workspaces", () => ({
  updateWorkspace: vi.fn(),
  getWorkspaceAccess: vi.fn(),
  setWorkspaceAccess: vi.fn(),
  removeWorkspaceAccess: vi.fn(),
}));

const updateWorkspace = vi.mocked(workspacesApi.updateWorkspace);
const getAccess = vi.mocked(workspacesApi.getWorkspaceAccess);
const setAccess = vi.mocked(workspacesApi.setWorkspaceAccess);
const removeAccess = vi.mocked(workspacesApi.removeWorkspaceAccess);

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

const ENTRADAS: AccessEntry[] = [
  { group_id: 1, group_name: "Administradores", is_default: false, is_admin_group: true, role: "admin" as never },
  { group_id: 2, group_name: "Todos os usuários", is_default: true, is_admin_group: false, role: "viewer" },
  { group_id: 3, group_name: "Dados", is_default: false, is_admin_group: false, role: null },
  { group_id: 4, group_name: "Diretoria", is_default: false, is_admin_group: false, role: "editor" },
];

const onSaved = vi.fn();
const onClose = vi.fn();

const seletor = (grupo: string) => {
  const linha = screen.getByText(new RegExp(grupo)).closest("tr") as HTMLElement;
  return within(linha).getByRole("combobox") as HTMLSelectElement;
};
const salvar = () => screen.getByText("Salvar") as HTMLButtonElement;

async function abrir(manageAccess = true) {
  render(<EditCollectionModal workspace={COLECAO} manageAccess={manageAccess} onSaved={onSaved} onClose={onClose} />);
  if (manageAccess) await screen.findByText("Acesso por grupo");
}

beforeEach(() => {
  mocks.showToast.mockClear();
  onSaved.mockClear();
  onClose.mockClear();
  updateWorkspace.mockReset();
  updateWorkspace.mockResolvedValue(COLECAO);
  getAccess.mockReset();
  getAccess.mockResolvedValue(ENTRADAS);
  setAccess.mockReset();
  setAccess.mockResolvedValue(ENTRADAS[1]);
  removeAccess.mockReset();
  removeAccess.mockResolvedValue(ENTRADAS[1]);
});

describe("EditCollectionModal - sem gerenciar acesso (Home)", () => {
  it("não busca o acesso nem mostra a lista de grupos", async () => {
    await abrir(false);

    expect(screen.getByText("Editar coleção")).toBeTruthy();
    expect(getAccess).not.toHaveBeenCalled();
    expect(screen.queryByText("Acesso por grupo")).toBeNull();
  });

  it("salva só os dados da coleção e fecha, sem tocar no acesso", async () => {
    await abrir(false);

    fireEvent.change(screen.getByLabelText("Nome da coleção"), { target: { value: "Comercial 2" } });
    fireEvent.click(salvar());

    await waitFor(() =>
      expect(updateWorkspace).toHaveBeenCalledWith(7, { name: "Comercial 2", description: "Vendas do mês", icon: null, color: null }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
    expect(setAccess).not.toHaveBeenCalled();
    expect(removeAccess).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("Coleção atualizada.");
  });
});

describe("EditCollectionModal - acesso dos grupos", () => {
  it("mostra os grupos com o acesso atual e esconde o grupo administrador", async () => {
    await abrir();

    expect(screen.queryByText("Administradores")).toBeNull();
    expect(seletor("Todos os usuários").value).toBe("viewer");
    expect(seletor("Dados").value).toBe("none");
    expect(seletor("Diretoria").value).toBe("editor");
    expect(screen.getByText("padrão")).toBeTruthy();
  });

  it("enquanto carrega mostra o esqueleto e depois a lista", async () => {
    let resolver: (e: AccessEntry[]) => void = () => undefined;
    getAccess.mockImplementation(() => new Promise((resolve) => (resolver = resolve)));
    render(<EditCollectionModal workspace={COLECAO} manageAccess onSaved={onSaved} onClose={onClose} />);

    expect(screen.queryByText("Acesso por grupo")).toBeNull();
    resolver(ENTRADAS);
    await screen.findByText("Acesso por grupo");
  });

  it("mudar o acesso não grava na hora: só ao clicar em Salvar", async () => {
    await abrir();

    fireEvent.change(seletor("Dados"), { target: { value: "viewer" } });

    expect(setAccess).not.toHaveBeenCalled();
    expect(updateWorkspace).not.toHaveBeenCalled();
  });

  it("Salvar grava só os grupos que mudaram: dar acesso, tirar acesso e mudar o nível", async () => {
    await abrir();

    fireEvent.change(seletor("Dados"), { target: { value: "viewer" } });
    fireEvent.change(seletor("Todos os usuários"), { target: { value: "none" } });
    fireEvent.change(seletor("Diretoria"), { target: { value: "viewer" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updateWorkspace).toHaveBeenCalledTimes(1);
    expect(setAccess).toHaveBeenCalledTimes(2);
    expect(setAccess).toHaveBeenCalledWith(7, 3, "viewer");
    expect(setAccess).toHaveBeenCalledWith(7, 4, "viewer");
    expect(removeAccess).toHaveBeenCalledTimes(1);
    expect(removeAccess).toHaveBeenCalledWith(7, 2);
    expect(mocks.showToast).toHaveBeenCalledWith("Coleção atualizada.");
  });

  it("sem mudar o acesso não chama as rotas de acesso", async () => {
    await abrir();

    fireEvent.change(screen.getByLabelText("Nome da coleção"), { target: { value: "Comercial 2" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(setAccess).not.toHaveBeenCalled();
    expect(removeAccess).not.toHaveBeenCalled();
  });

  it("mudar e voltar ao valor salvo não conta como mudança", async () => {
    await abrir();

    fireEvent.change(seletor("Dados"), { target: { value: "viewer" } });
    fireEvent.change(seletor("Dados"), { target: { value: "none" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(setAccess).not.toHaveBeenCalled();
    expect(removeAccess).not.toHaveBeenCalled();
  });

  it("falha num grupo: os outros ficam gravados, a janela continua aberta e avisa qual falhou", async () => {
    await abrir();
    setAccess.mockImplementation(async (_id, groupId) => {
      if (groupId === 3) throw { response: { data: { detail: "Sem permissão" } } };
      return ENTRADAS[1];
    });

    fireEvent.change(seletor("Dados"), { target: { value: "viewer" } });
    fireEvent.change(seletor("Diretoria"), { target: { value: "viewer" } });
    fireEvent.click(salvar());

    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent).toContain("Os dados da coleção foram salvos");
    expect(aviso.textContent).toContain("Dados");
    expect(aviso.textContent).not.toContain("Diretoria");
    expect(setAccess).toHaveBeenCalledWith(7, 4, "viewer");
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalledWith("Coleção atualizada.");
    // A lista é lida de novo para mostrar o valor real do servidor
    await waitFor(() => expect(getAccess).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(salvar().disabled).toBe(false));
  });

  it("falha ao salvar os dados da coleção avisa o erro e não mexe no acesso", async () => {
    await abrir();
    updateWorkspace.mockRejectedValue({ response: { data: { detail: "Nome já existe" } } });

    fireEvent.change(seletor("Dados"), { target: { value: "viewer" } });
    fireEvent.click(salvar());

    expect((await screen.findByRole("alert")).textContent).toBe("Nome já existe");
    expect(setAccess).not.toHaveBeenCalled();
    expect(removeAccess).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sem permissão de administrador mostra o motivo e ainda deixa editar os dados da coleção", async () => {
    getAccess.mockRejectedValue({ response: { status: 403, data: { detail: "Forbidden" } } });
    render(<EditCollectionModal workspace={COLECAO} manageAccess onSaved={onSaved} onClose={onClose} />);

    expect(await screen.findByText(/Só administradores da plataforma/)).toBeTruthy();
    expect(screen.queryByText("Acesso por grupo")).toBeNull();

    fireEvent.change(screen.getByLabelText("Nome da coleção"), { target: { value: "Comercial 2" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(updateWorkspace).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(setAccess).not.toHaveBeenCalled();
    expect(removeAccess).not.toHaveBeenCalled();
  });

  it("outro erro ao carregar o acesso mostra o aviso do servidor", async () => {
    getAccess.mockRejectedValue({ response: { status: 500, data: { detail: "Banco fora do ar" } } });
    render(<EditCollectionModal workspace={COLECAO} manageAccess onSaved={onSaved} onClose={onClose} />);

    expect(await screen.findByText("Banco fora do ar")).toBeTruthy();
  });

  it("Cancelar fecha sem gravar nada", async () => {
    await abrir();

    fireEvent.change(seletor("Dados"), { target: { value: "viewer" } });
    fireEvent.click(screen.getByText("Cancelar"));

    expect(onClose).toHaveBeenCalled();
    expect(updateWorkspace).not.toHaveBeenCalled();
    expect(setAccess).not.toHaveBeenCalled();
  });

  it("enquanto grava mostra Salvando e desliga o botão", async () => {
    await abrir();
    let terminar: () => void = () => undefined;
    updateWorkspace.mockImplementation(() => new Promise((resolve) => (terminar = () => resolve(COLECAO))));

    fireEvent.click(salvar());

    const botao = await screen.findByText("Salvando...");
    expect((botao as HTMLButtonElement).disabled).toBe(true);
    terminar();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

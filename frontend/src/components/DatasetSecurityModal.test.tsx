import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatasetSecurity } from "../api/datasetSecurity";
import DatasetSecurityModal from "./DatasetSecurityModal";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  getDatasetSecurity: vi.fn(),
  saveDatasetSecurity: vi.fn(),
  testDatasetRole: vi.fn(),
  listGroups: vi.fn(),
  listUsers: vi.fn(),
}));

vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../api/datasetSecurity", () => ({
  getDatasetSecurity: mocks.getDatasetSecurity,
  saveDatasetSecurity: mocks.saveDatasetSecurity,
  testDatasetRole: mocks.testDatasetRole,
}));
vi.mock("../api/groups", () => ({ listGroups: mocks.listGroups }));
vi.mock("../api/users", () => ({ listUsers: mocks.listUsers }));

function security(parts: Partial<DatasetSecurity> = {}): DatasetSecurity {
  return {
    dataset_id: 3,
    name: "Modelo 1",
    pbi_workspace_name: "Financeiro",
    requires_identity: true,
    rls_shared_by_roles: null,
    reports_count: 2,
    active: false,
    grants: [],
    ...parts,
  };
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.getDatasetSecurity.mockResolvedValue(security());
  mocks.saveDatasetSecurity.mockResolvedValue(security());
  mocks.listGroups.mockResolvedValue([
    { id: 7, name: "Regional A", is_default: false, is_admin_group: false },
    { id: 8, name: "Administradores", is_default: false, is_admin_group: true },
  ]);
  mocks.listUsers.mockResolvedValue([{ id: 5, name: "Ana", email: "ana@example.com", groups: [], last_login: null, is_blocked: false }]);
});

async function abrir(onClose = vi.fn(), onSaved = vi.fn()) {
  render(<DatasetSecurityModal datasetId={3} datasetName="Modelo 1" onClose={onClose} onSaved={onSaved} />);
  // O campo Funcao so aparece depois de carregar
  await screen.findByLabelText("Função");
  return { onClose, onSaved };
}

describe("DatasetSecurityModal", () => {
  it("sem funcoes avisa que o modelo funciona como antes e explica a falha fechada", async () => {
    await abrir();

    expect(screen.getByText(/este modelo funciona como antes/)).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/não receber nenhuma não abre/);
  });

  it("mostra o que ja esta mapeado", async () => {
    mocks.getDatasetSecurity.mockResolvedValue(
      security({ active: true, grants: [{ group_id: 7, user_id: null, subject_name: "Regional A", subject_email: null, pbi_role: "Regional A" }] }),
    );
    await abrir();

    expect(screen.getByText("Grupo Regional A")).toBeTruthy();
    expect(screen.getAllByText("Regional A").length).toBeGreaterThan(0);
  });

  it("adiciona um grupo com a funcao e grava a lista, avisando e fechando", async () => {
    const { onClose, onSaved } = await abrir();

    fireEvent.change(screen.getByLabelText("Grupo ou pessoa"), { target: { value: "g:7" } });
    fireEvent.change(screen.getByLabelText("Função"), { target: { value: "  Regional A " } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(mocks.saveDatasetSecurity).toHaveBeenCalledWith(3, {
        rls_shared_by_roles: null,
        grants: [{ group_id: 7, user_id: null, pbi_role: "Regional A" }],
      }),
    );
    expect(mocks.showToast).toHaveBeenCalledWith("Segurança do modelo salva.");
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("adiciona uma pessoa e a mesma linha repetida nao duplica", async () => {
    await abrir();

    for (let i = 0; i < 2; i++) {
      fireEvent.change(screen.getByLabelText("Grupo ou pessoa"), { target: { value: "u:5" } });
      fireEvent.change(screen.getByLabelText("Função"), { target: { value: "Auditoria" } });
      fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(mocks.saveDatasetSecurity).toHaveBeenCalled());
    expect(mocks.saveDatasetSecurity.mock.calls[0][1].grants).toEqual([{ group_id: null, user_id: 5, pbi_role: "Auditoria" }]);
  });

  it("adicionar sem escolher quem ou sem a funcao e recusado na tela", async () => {
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/Escolha um grupo ou uma pessoa/);
    expect(mocks.saveDatasetSecurity).not.toHaveBeenCalled();
  });

  it("remover tira a linha e salvar sem nenhuma devolve o modelo ao comportamento de antes", async () => {
    mocks.getDatasetSecurity.mockResolvedValue(
      security({ active: true, grants: [{ group_id: 7, user_id: null, subject_name: "Regional A", subject_email: null, pbi_role: "A" }] }),
    );
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(mocks.saveDatasetSecurity).toHaveBeenCalledWith(3, { rls_shared_by_roles: null, grants: [] }));
  });

  it("a marca de RLS so por funcao vai junto quando ligada", async () => {
    await abrir();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(mocks.saveDatasetSecurity).toHaveBeenCalledWith(3, { rls_shared_by_roles: true, grants: [] }));
  });

  it("testar a funcao mostra o que o Power BI respondeu, sem gravar nada", async () => {
    mocks.testDatasetRole.mockResolvedValue({ ok: false, message: "HTTP 400 -- funcao inexistente" });
    await abrir();

    fireEvent.change(screen.getByLabelText("Função"), { target: { value: "Nao existe" } });
    fireEvent.click(screen.getByRole("button", { name: "Testar função" }));

    expect(await screen.findByText(/funcao inexistente/)).toBeTruthy();
    expect(mocks.testDatasetRole).toHaveBeenCalledWith(3, "Nao existe");
    expect(mocks.saveDatasetSecurity).not.toHaveBeenCalled();
  });

  it("erro ao salvar fica na tela e nao fecha", async () => {
    mocks.saveDatasetSecurity.mockRejectedValue({ response: { data: { detail: "Grupo nao encontrado" } } });
    const { onClose } = await abrir();

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/Grupo nao encontrado/);
    expect(onClose).not.toHaveBeenCalled();
  });
});

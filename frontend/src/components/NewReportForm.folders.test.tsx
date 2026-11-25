import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../api/access";
import type { Report } from "../api/reports";
import { AccessContext, buildAccess } from "../context/AccessContext";
import NewReportForm from "./NewReportForm";

const mocks = vi.hoisted(() => ({
  updateReport: vi.fn(),
  getReportFolders: vi.fn(),
  setReportFolders: vi.fn(),
  listConnections: vi.fn(),
  listWorkspaces: vi.fn(),
  listReports: vi.fn(),
  listPages: vi.fn(),
}));

vi.mock("../api/reports", () => ({
  updateReport: mocks.updateReport,
  getReportFolders: mocks.getReportFolders,
  setReportFolders: mocks.setReportFolders,
  createReport: vi.fn(),
}));
vi.mock("../api/powerbiConnections", () => ({ listConnections: mocks.listConnections }));
vi.mock("../api/powerbi", () => ({
  listPowerBIWorkspaces: mocks.listWorkspaces,
  listPowerBIReports: mocks.listReports,
  listPowerBIPages: mocks.listPages,
}));
vi.mock("../context/WorkspaceContext", () => ({
  useWorkspace: () => ({
    currentWorkspace: { id: 1, name: "Comercial" },
    workspaces: [
      { id: 1, name: "Comercial" },
      { id: 2, name: "Financeiro" },
      { id: 3, name: "Custos" },
    ],
  }),
}));

const report = {
  id: 10,
  collection_id: 1,
  name: "Vendas",
  powerbi_connection_id: 5,
  pbi_workspace_id: "ws",
  pbi_report_id: "rep",
  pbi_dataset_id: null,
  pbi_page_names: [],
  display_type: "relatorio",
  show_filter_pane: false,
  show_page_nav: false,
  show_visual_header: false,
} as unknown as Report;

function renderForm(me: Partial<MyAccess>, onCreated = vi.fn()) {
  const access = buildAccess({ is_admin: false, global_permissions: [], workspace_permissions: {}, ...me });
  render(
    <AccessContext.Provider value={access}>
      <NewReportForm editingReport={report} onCreated={onCreated} onClose={() => {}} />
    </AccessContext.Provider>,
  );
  return onCreated;
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.listConnections.mockResolvedValue([{ id: 5, name: "Conta", tenant_id: "t", client_id: "c", client_secret_configured: true }]);
  mocks.listWorkspaces.mockResolvedValue([{ id: "ws", name: "WS" }]);
  mocks.listReports.mockResolvedValue([{ id: "rep", name: "Vendas", dataset_id: null }]);
  mocks.listPages.mockResolvedValue([]);
  mocks.updateReport.mockResolvedValue(report);
  mocks.getReportFolders.mockResolvedValue({ collection_ids: [1, 2], in_root: false });
  mocks.setReportFolders.mockResolvedValue({ collection_ids: [1], in_root: false });
});

const publicar = { workspace_permissions: { "1": ["relatorio.publicar"], "2": ["relatorio.publicar"], "3": ["relatorio.publicar"] } };

describe("NewReportForm: pastas do relatorio", () => {
  it("quem pode publicar ve em quais pastas o relatorio aparece", async () => {
    renderForm(publicar);

    expect(await screen.findByText("Aparece em")).toBeTruthy();
    await waitFor(() => expect(mocks.getReportFolders).toHaveBeenCalledWith(1, 10));
  });

  it("quem nao pode publicar em nenhuma pasta nao ve o campo nem consulta as pastas", async () => {
    renderForm({ workspace_permissions: { "1": ["colecao.ver"] } });

    await screen.findByText("Conta do Power BI");

    expect(screen.queryByText("Aparece em")).toBeNull();
    expect(mocks.getReportFolders).not.toHaveBeenCalled();
  });

  it("salvar sem mexer nas pastas so atualiza o relatorio", async () => {
    const onCreated = renderForm(publicar);
    await screen.findByText("Aparece em");
    await waitFor(() => expect(mocks.getReportFolders).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(mocks.updateReport).toHaveBeenCalled();
    expect(mocks.setReportFolders).not.toHaveBeenCalled();
  });

  it("mudar as pastas grava a lista nova depois de atualizar o relatorio", async () => {
    const onCreated = renderForm(publicar);
    await screen.findByText("Aparece em");
    await waitFor(() => expect(mocks.getReportFolders).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /Pastas do relatório|2 selecionados/ }));
    fireEvent.click(await screen.findByLabelText(/Custos/));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(mocks.setReportFolders).toHaveBeenCalledWith(1, 10, [1, 2, 3]));
    expect(onCreated).toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../api/access";
import { AccessContext, buildAccess } from "../context/AccessContext";
import Catalog from "./Catalog";

const mocks = vi.hoisted(() => ({
  listCatalogReports: vi.fn(),
  listCatalogDatasets: vi.fn(),
  listCatalogOrigins: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ Navigate: ({ to }: { to: string }) => <div data-testid="navegou">{to}</div> }));
vi.mock("../api/catalog", () => mocks);
// A janela de seguranca tem teste proprio (DatasetSecurityModal.test.tsx)
vi.mock("../components/DatasetSecurityModal", () => ({ default: () => null }));

function renderCatalog(globais: string[]) {
  const me: MyAccess = { is_admin: false, global_permissions: globais, workspace_permissions: {} };
  return render(
    <AccessContext.Provider value={buildAccess(me)}>
      <Catalog />
    </AccessContext.Provider>,
  );
}

const report = {
  id: 1,
  name: "Resultado",
  connection_id: 1,
  connection_name: "Conta",
  pbi_workspace_id: "ws-a",
  pbi_workspace_name: "Financeiro",
  pbi_report_id: "rep-1",
  pbi_dataset_id: "ds-1",
  source: "sync",
  in_root: true,
  collection_id: 1,
  collection_name: "Raiz",
  synced_at: "2026-11-25T10:00:00Z",
  sync_missing_at: null,
};

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.listCatalogOrigins.mockResolvedValue(["Comercial", "Financeiro"]);
  mocks.listCatalogReports.mockResolvedValue({ items: [report], total: 1, page: 1, page_size: 25 });
  mocks.listCatalogDatasets.mockResolvedValue({
    items: [
      {
        id: 1,
        name: "Modelo financeiro",
        connection_id: 1,
        connection_name: "Conta",
        pbi_workspace_id: "ws-a",
        pbi_workspace_name: "Financeiro",
        pbi_dataset_id: "ds-1",
        requires_identity: true,
        reports_count: 2,
        synced_at: null,
        sync_missing_at: null,
      },
    ],
    total: 1,
    page: 1,
    page_size: 25,
  });
});

describe("Catalog", () => {
  it("sem nenhuma das permissoes do catalogo, a pessoa volta para o inicio", () => {
    renderCatalog(["sistema.geral"]);

    expect(screen.getByTestId("navegou").textContent).toBe("/");
    expect(mocks.listCatalogReports).not.toHaveBeenCalled();
  });

  it("lista os relatorios importados dizendo onde estao e a origem", async () => {
    renderCatalog(["relatorio.catalogo"]);

    expect(await screen.findByText("Resultado")).toBeTruthy();
    expect(screen.getByText("Financeiro", { selector: "td" })).toBeTruthy();
    expect(screen.getByText("Raiz", { selector: "td" })).toBeTruthy();
  });

  it("marca como nao encontrado o relatorio que sumiu do Power BI", async () => {
    mocks.listCatalogReports.mockResolvedValue({
      items: [{ ...report, sync_missing_at: "2026-11-25T11:00:00Z" }],
      total: 1,
      page: 1,
      page_size: 25,
    });
    renderCatalog(["relatorio.catalogo"]);

    expect(await screen.findByText("Não encontrado")).toBeTruthy();
  });

  it("filtra por estado e volta para a primeira pagina", async () => {
    renderCatalog(["relatorio.catalogo"]);
    await screen.findByText("Resultado");

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "missing" } });

    await waitFor(() =>
      expect(mocks.listCatalogReports).toHaveBeenLastCalledWith(expect.objectContaining({ state: "missing", page: 1 })),
    );
  });

  it("so com a permissao dos modelos, mostra direto a lista de modelos e nao mexe nos relatorios", async () => {
    renderCatalog(["modelo.catalogo"]);

    expect(await screen.findByText("Modelo financeiro")).toBeTruthy();
    expect(screen.getByText("Exige identidade (RLS)")).toBeTruthy();
    expect(mocks.listCatalogReports).not.toHaveBeenCalled();
    expect(mocks.listCatalogOrigins).not.toHaveBeenCalled();
  });

  it("a coluna de funcoes diz quantas estao mapeadas, e so quem tem a permissao ve o botao Seguranca", async () => {
    mocks.listCatalogDatasets.mockResolvedValue({
      items: [
        { id: 1, name: "Modelo financeiro", connection_id: 1, connection_name: "Conta", pbi_workspace_id: "ws-a", pbi_workspace_name: "Financeiro", pbi_dataset_id: "ds-1", requires_identity: true, reports_count: 2, role_grants: 3, synced_at: null, sync_missing_at: null },
      ],
      total: 1,
      page: 1,
      page_size: 25,
    });
    const { unmount } = renderCatalog(["modelo.catalogo"]);
    expect(await screen.findByText(/3 mapeadas \(exige função\)/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Segurança" })).toBeNull();
    unmount();

    renderCatalog(["modelo.catalogo", "modelo.seguranca"]);
    expect(await screen.findByRole("button", { name: "Segurança" })).toBeTruthy();
  });

  it("lista vazia explica como importar", async () => {
    mocks.listCatalogReports.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    renderCatalog(["relatorio.catalogo"]);

    expect(await screen.findByText(/Para importar os do tenant, use Sincronizar/)).toBeTruthy();
  });
});

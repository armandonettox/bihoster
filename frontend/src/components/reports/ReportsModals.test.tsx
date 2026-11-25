import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../../api/access";
import type { CatalogItem } from "../../api/workspaceCatalog";
import { AccessContext, buildAccess } from "../../context/AccessContext";
import { BulkShareModal, FoldersModal, HistoryModal } from "./ReportsModals";

const mocks = vi.hoisted(() => ({
  getReportFolders: vi.fn(),
  setReportFolders: vi.fn(),
  bulkFolders: vi.fn(),
  bulkShare: vi.fn(),
  getKindCatalog: vi.fn(),
  searchSubjects: vi.fn(),
  getDatasetHistory: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../api/reports", () => ({ getReportFolders: mocks.getReportFolders, setReportFolders: mocks.setReportFolders }));
vi.mock("../../api/accessPanel", () => ({
  bulkFolders: mocks.bulkFolders,
  bulkShare: mocks.bulkShare,
  getKindCatalog: mocks.getKindCatalog,
  searchSubjects: mocks.searchSubjects,
}));
vi.mock("../../api/workspaceCatalog", () => ({ getDatasetHistory: mocks.getDatasetHistory }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../context/WorkspaceContext", () => ({
  useWorkspace: () => ({ workspaces: [{ id: 1, name: "Financeiro" }, { id: 2, name: "Comercial" }, { id: 3, name: "Custos" }] }),
}));
// A lista suspensa de pastas tem teste proprio: aqui vira caixas simples
vi.mock("../MultiSelect", () => ({
  default: ({ label, options, selected, onChange }: { label: string; options: { value: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void }) => (
    <div role="group" aria-label={label}>
      {options.map((o) => (
        <label key={o.value}>
          <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onChange(selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value])} />
          {o.label}
        </label>
      ))}
    </div>
  ),
}));

function report(id: number, name: string, parts: Partial<CatalogItem> = {}): CatalogItem {
  return {
    kind: "report", id, name, connection_id: 1, pbi_workspace_id: "ws", pbi_workspace_name: "WS", collection_id: 10, folders: [], in_root: true, updated_at: null, last_refresh_at: null, next_refresh_at: null, last_refresh_status: null, missing: false,
    dataset_id: null, dataset_name: null, rls: { requires_identity: null, role_grants: 0 }, access: { count: 0, people: [] }, pending: true,
    can: { open: true, share: true, security: false, refresh: false, history: false, folders: true }, ...parts,
  };
}

function withAccess(ui: React.ReactElement, me: Partial<MyAccess> = { is_admin: true }) {
  return render(<AccessContext.Provider value={buildAccess({ is_admin: false, global_permissions: [], workspace_permissions: {}, ...me })}>{ui}</AccessContext.Provider>);
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.getReportFolders.mockResolvedValue({ collection_ids: [1], in_root: false });
  mocks.setReportFolders.mockResolvedValue({ collection_ids: [1, 2], in_root: false });
  mocks.bulkFolders.mockResolvedValue({ items: 2, subjects: 1, changes: 2 });
  mocks.bulkShare.mockResolvedValue({ items: 2, subjects: 1, changes: 2 });
  mocks.getKindCatalog.mockResolvedValue({ presets: [{ key: "ver", label: "Ver", permissions: [] }, { key: "exportar", label: "Ver e exportar", permissions: [] }], permissions: [] });
  mocks.searchSubjects.mockResolvedValue([{ kind: "user", id: 8, name: "Beto Lima", email: "beto@example.com", picture_url: null }]);
});

describe("FoldersModal", () => {
  it("de um relatorio so: carrega as pastas atuais e salva a lista nova", async () => {
    const onDone = vi.fn();
    withAccess(<FoldersModal reports={[report(7, "Resultado", { in_root: false })]} onClose={() => {}} onDone={onDone} />);
    await waitFor(() => expect((screen.getByLabelText("Financeiro") as HTMLInputElement).checked).toBe(true));

    fireEvent.click(screen.getByLabelText("Comercial"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(mocks.setReportFolders).toHaveBeenCalledWith(10, 7, [1, 2]));
    expect(onDone).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("Pastas atualizadas.");
  });

  it("sem mudar nada o botao Salvar fica desligado", async () => {
    withAccess(<FoldersModal reports={[report(7, "Resultado")]} onClose={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(mocks.getReportFolders).toHaveBeenCalled());

    expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("em lote: so grava depois de Revisar e Confirmar, e avisa que os do catalogo serao publicados", async () => {
    const onDone = vi.fn();
    withAccess(<FoldersModal reports={[report(7, "A"), report(8, "B", { in_root: false })]} onClose={() => {}} onDone={onDone} />);

    fireEvent.click(within_group("Pôr nas pastas", "Comercial"));
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));

    expect(screen.getByText(/2 relatórios entram em: Comercial/)).toBeTruthy();
    expect(screen.getByText(/1 está só no catálogo e será publicado/)).toBeTruthy();
    expect(mocks.bulkFolders).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocks.bulkFolders).toHaveBeenCalledWith({ report_ids: [7, 8], add: [2], remove: [] }));
    expect(onDone).toHaveBeenCalled();
  });

  it("quem nao pode publicar em nenhuma pasta ve a explicacao", () => {
    withAccess(<FoldersModal reports={[report(7, "A")]} onClose={() => {}} onDone={() => {}} />, { is_admin: false });

    expect(screen.getByText(/não pode publicar relatórios em nenhuma pasta/)).toBeTruthy();
  });

  it("erro do servidor fica na janela e volta para a revisao", async () => {
    mocks.bulkFolders.mockRejectedValue({ response: { data: { detail: "Voce nao pode publicar nem tirar relatorios de uma das pastas" } } });
    withAccess(<FoldersModal reports={[report(7, "A"), report(8, "B")]} onClose={() => {}} onDone={() => {}} />);

    fireEvent.click(within_group("Pôr nas pastas", "Custos"));
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/nao pode publicar/);
    expect(screen.getByRole("button", { name: "Revisar" })).toBeTruthy();
  });
});

function within_group(group: string, label: string): HTMLElement {
  const container = screen.getByRole("group", { name: group });
  return Array.from(container.querySelectorAll("label")).find((l) => l.textContent === label)!.querySelector("input") as HTMLElement;
}

describe("HistoryModal", () => {
  it("lista as atualizacoes com estado, tipo e datas", async () => {
    mocks.getDatasetHistory.mockResolvedValue([{ status: "Completed", kind: "Scheduled", started_at: "2026-11-25T01:00:00Z", ended_at: "2026-11-25T01:05:00Z", error: null }, { status: "Failed", kind: "OnDemand", started_at: null, ended_at: null, error: "Credenciais vencidas" }]);
    render(<HistoryModal datasetId={3} name="Modelo 1" onClose={() => {}} />);

    expect(await screen.findByText("Completed")).toBeTruthy();
    expect(screen.getByText("Credenciais vencidas")).toBeTruthy();
    expect(screen.getByText("OnDemand")).toBeTruthy();
  });

  it("sem historico diz isso e erro aparece", async () => {
    mocks.getDatasetHistory.mockResolvedValue([]);
    const { unmount } = render(<HistoryModal datasetId={3} name="Modelo 1" onClose={() => {}} />);
    expect(await screen.findByText(/não informou nenhuma atualização/)).toBeTruthy();
    unmount();

    mocks.getDatasetHistory.mockRejectedValue({ response: { data: { detail: "Sem permissao" } } });
    render(<HistoryModal datasetId={3} name="Modelo 1" onClose={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Sem permissao/);
  });
});

describe("BulkShareModal", () => {
  it("escolhe a pessoa, o preset, revisa o que muda e so entao grava", async () => {
    const onDone = vi.fn();
    render(<BulkShareModal items={[report(1, "A"), report(2, "B", { in_root: false })]} onClose={() => {}} onDone={onDone} />);
    await waitFor(() => expect(mocks.getKindCatalog).toHaveBeenCalledWith("report"));

    fireEvent.change(screen.getByRole("combobox", { name: "Pessoa ou grupo" }), { target: { value: "be" } });
    fireEvent.click(await screen.findByRole("option", { name: /Beto Lima/ }));
    fireEvent.change(screen.getByLabelText("O que pode fazer"), { target: { value: "exportar" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));

    expect(screen.getByText(/Beto Lima passa a ter “Ver e exportar” em 2 relatórios/)).toBeTruthy();
    expect(screen.getByText(/1 relatório do catálogo será publicado para Beto Lima/)).toBeTruthy();
    expect(mocks.bulkShare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(mocks.bulkShare).toHaveBeenCalledWith({ items: [{ kind: "report", id: 1 }, { kind: "report", id: 2 }], user_ids: [8], group_ids: [], preset: "exportar" }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("sem escolher quem, Revisar fica desligado; mudar o preset volta para a revisao", async () => {
    render(<BulkShareModal items={[report(1, "A")]} onClose={() => {}} onDone={() => {}} />);

    expect((screen.getByRole("button", { name: "Revisar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("mistura relatorio e modelo: so ficam os presets comuns", async () => {
    mocks.getKindCatalog.mockImplementation(async (kind: string) => ({ presets: kind === "report" ? [{ key: "ver", label: "Ver", permissions: [] }, { key: "exportar", label: "Ver e exportar", permissions: [] }] : [{ key: "ver", label: "Ver", permissions: [] }, { key: "atualizar", label: "Ver e atualizar", permissions: [] }], permissions: [] }));
    render(<BulkShareModal items={[report(1, "A"), { ...report(2, "Modelo"), kind: "dataset" }]} onClose={() => {}} onDone={() => {}} />);

    await waitFor(() => expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Ver"]));
  });

  it("erro do servidor volta para a escolha com a mensagem", async () => {
    mocks.bulkShare.mockRejectedValue({ response: { data: { detail: "Voce so pode dar ou tirar permissoes que voce mesmo tem" } } });
    render(<BulkShareModal items={[report(1, "A")]} onClose={() => {}} onDone={() => {}} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Pessoa ou grupo" }), { target: { value: "be" } });
    fireEvent.click(await screen.findByRole("option", { name: /Beto Lima/ }));
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/so pode dar ou tirar/);
    expect(screen.getByRole("button", { name: "Revisar" })).toBeTruthy();
  });
});

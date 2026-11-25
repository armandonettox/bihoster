import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SubjectItemGrants from "./SubjectItemGrants";

const mocks = vi.hoisted(() => ({
  itemsOfSubject: vi.fn(),
  putSubject: vi.fn(),
  getKindCatalog: vi.fn(),
  listItems: vi.fn(),
  listConnections: vi.fn(),
  getPerson: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../api/accessPanel", () => ({
  itemsOfSubject: mocks.itemsOfSubject,
  putSubject: mocks.putSubject,
  getKindCatalog: mocks.getKindCatalog,
}));
vi.mock("../api/workspaceCatalog", () => ({ listItems: mocks.listItems }));
vi.mock("../api/powerbiConnections", () => ({ listConnections: mocks.listConnections }));
vi.mock("../api/reportAccess", () => ({ getPerson: mocks.getPerson }));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));

const presets = [
  { key: "ver", label: "Ver", permissions: ["relatorio.ver"] },
  { key: "gerenciar", label: "Gerenciar", permissions: ["relatorio.ver", "relatorio.compartilhar"] },
];

function row(id: number, name: string, parts: Record<string, unknown> = {}) {
  return { kind: "report", id, name, subtitle: "Financeiro", in_root: false, permissions: ["relatorio.ver"], preset: "ver", ...parts };
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.getKindCatalog.mockResolvedValue({ presets, permissions: [{ key: "relatorio.ver", label: "Ver o relatório", description: "" }, { key: "relatorio.compartilhar", label: "Compartilhar o relatório", description: "" }] });
  mocks.itemsOfSubject.mockImplementation(async (_k: string, _id: number, params: { kind: string }) =>
    params.kind === "report"
      ? { items: [row(1, "Resultado"), row(2, "Fluxo", { in_root: true, permissions: ["relatorio.ver", "relatorio.compartilhar"], preset: "gerenciar" })], total: 2, page: 1, page_size: 10 }
      : { items: [], total: 0, page: 1, page_size: 10 },
  );
  mocks.putSubject.mockResolvedValue({ permissions: [], preset: null });
  mocks.listItems.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8, pending_total: 0 });
  mocks.getPerson.mockResolvedValue({ user_id: 5, name: "Ana", is_admin: false, rows: [{ report: { id: 1, name: "Resultado", collection_id: 2, collection_name: "Financeiro", in_root: false }, permissions: ["relatorio.ver"], sources: ["Grupo Dados"] }], total: 1, page: 1, page_size: 10 });
});

describe("SubjectItemGrants", () => {
  it("mostra os relatorios dados direto com o preset e diz quando esta so no catalogo", async () => {
    render(<SubjectItemGrants subjectKind="user" subjectId={5} />);

    expect(await screen.findByLabelText("Acesso a Resultado")).toBeTruthy();
    expect(screen.getByText(/só no catálogo/)).toBeTruthy();
    expect((screen.getByLabelText("Acesso a Resultado") as HTMLSelectElement).value).toBe("ver");
    expect((screen.getByLabelText("Acesso a Fluxo") as HTMLSelectElement).value).toBe("gerenciar");
    expect(screen.getByText("Nenhum modelo dado direto.")).toBeTruthy();
  });

  it("trocar o preset grava na hora e o desfazer restaura o que havia", async () => {
    render(<SubjectItemGrants subjectKind="group" subjectId={7} />);
    await screen.findByLabelText("Acesso a Resultado");

    fireEvent.change(screen.getByLabelText("Acesso a Resultado"), { target: { value: "gerenciar" } });

    await waitFor(() => expect(mocks.putSubject).toHaveBeenCalledWith("report", 1, "group", 7, { preset: "gerenciar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(mocks.putSubject).toHaveBeenLastCalledWith("report", 1, "group", 7, { permissions: ["relatorio.ver"] }));
  });

  it("remover manda lista vazia", async () => {
    render(<SubjectItemGrants subjectKind="user" subjectId={5} />);
    await screen.findByLabelText("Acesso a Resultado");

    fireEvent.change(screen.getByLabelText("Acesso a Resultado"), { target: { value: "__remove" } });

    await waitFor(() => expect(mocks.putSubject).toHaveBeenCalledWith("report", 1, "user", 5, { permissions: [] }));
  });

  it("adicionar relatorio busca no catalogo e da o preset Ver", async () => {
    mocks.listItems.mockResolvedValue({ items: [{ kind: "report", id: 9, name: "Vendas", pbi_workspace_name: "Comercial" }], total: 1, page: 1, page_size: 8, pending_total: 0 });
    render(<SubjectItemGrants subjectKind="user" subjectId={5} />);
    await screen.findByLabelText("Acesso a Resultado");

    fireEvent.change(screen.getByRole("combobox", { name: "Adicionar relatório" }), { target: { value: "vend" } });
    fireEvent.click(await screen.findByRole("option", { name: /Vendas/ }));

    await waitFor(() => expect(mocks.putSubject).toHaveBeenCalledWith("report", 9, "user", 5, { preset: "ver" }));
    expect(mocks.listItems).toHaveBeenCalledWith(expect.objectContaining({ kind: "report", search: "vend" }));
  });

  it("sem acesso ao catalogo avisa em vez de falhar calado", async () => {
    mocks.listItems.mockRejectedValue(new Error("403"));
    render(<SubjectItemGrants subjectKind="user" subjectId={5} />);
    await screen.findByLabelText("Acesso a Resultado");

    fireEvent.change(screen.getByRole("combobox", { name: "Adicionar relatório" }), { target: { value: "vend" } });

    expect(await screen.findByText(/não tem acesso ao catálogo/)).toBeTruthy();
  });

  it("so leitura: sem seletor de acesso nem campo de adicionar", async () => {
    render(<SubjectItemGrants subjectKind="user" subjectId={5} readOnly />);
    await screen.findByLabelText("Acesso a Resultado");

    expect((screen.getByLabelText("Acesso a Resultado") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByRole("combobox", { name: "Adicionar relatório" })).toBeNull();
  });

  it("a pessoa tem a lista paginada do que ela ve e por que; o grupo nao", async () => {
    const { unmount } = render(<SubjectItemGrants subjectKind="user" subjectId={5} />);

    expect(await screen.findByText("Grupo Dados")).toBeTruthy();
    expect(mocks.getPerson).toHaveBeenCalledWith(5, expect.objectContaining({ page: 1, pageSize: 10 }));
    unmount();
    mocks.getPerson.mockClear();
    render(<SubjectItemGrants subjectKind="group" subjectId={7} />);
    await screen.findByLabelText("Acesso a Resultado");
    expect(mocks.getPerson).not.toHaveBeenCalled();
  });

  it("mais de uma pagina mostra a paginacao e a busca", async () => {
    mocks.itemsOfSubject.mockImplementation(async (_k: string, _id: number, params: { kind: string; page?: number }) =>
      params.kind === "report" ? { items: [row(params.page === 2 ? 11 : 1, params.page === 2 ? "Segunda pagina" : "Resultado")], total: 25, page: params.page ?? 1, page_size: 10 } : { items: [], total: 0, page: 1, page_size: 10 },
    );
    render(<SubjectItemGrants subjectKind="user" subjectId={5} />);
    await screen.findByLabelText("Acesso a Resultado");

    fireEvent.click(screen.getAllByRole("button", { name: "Próxima" })[0]);

    expect(await screen.findByText("Segunda pagina")).toBeTruthy();
    expect(screen.getByLabelText("Buscar em Relatórios")).toBeTruthy();
  });
});


describe("SubjectItemGrants: contas do Power BI", () => {
  it("tem a secao de contas e adicionar uma busca na lista de contas e da o preset da conta", async () => {
    mocks.getKindCatalog.mockImplementation(async (kind: string) => ({
      presets: kind === "connection" ? [{ key: "sincronizar", label: "Sincronizar", permissions: ["conexao.sincronizar"] }] : presets,
      permissions: [],
    }));
    mocks.listConnections.mockResolvedValue([
      { id: 4, name: "Empresa Principal", tenant_id: "tenant-x", client_id: "c", client_secret_configured: true },
      { id: 5, name: "Outra", tenant_id: "tenant-y", client_id: "c", client_secret_configured: true },
    ]);
    render(<SubjectItemGrants subjectKind="user" subjectId={5} />);
    await screen.findByLabelText("Acesso a Resultado");

    expect(screen.getByText("Nenhuma conta dada direto.")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Adicionar conta" }), { target: { value: "empres" } });
    fireEvent.click(await screen.findByRole("option", { name: /Empresa Principal/ }));

    await waitFor(() => expect(mocks.putSubject).toHaveBeenCalledWith("connection", 4, "user", 5, { preset: "sincronizar" }));
    expect(mocks.listItems).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "connection" }));
  });

  it("sem acesso a lista de contas avisa em vez de falhar calado", async () => {
    mocks.listConnections.mockRejectedValue(new Error("403"));
    render(<SubjectItemGrants subjectKind="user" subjectId={5} />);
    await screen.findByLabelText("Acesso a Resultado");

    fireEvent.change(screen.getByRole("combobox", { name: "Adicionar conta" }), { target: { value: "x" } });

    expect(await screen.findByText(/lista de contas/)).toBeTruthy();
  });
});

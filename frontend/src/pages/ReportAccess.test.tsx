import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../api/access";
import { AccessContext, buildAccess } from "../context/AccessContext";
import ReportAccess from "./ReportAccess";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  getReportCatalog: vi.fn(),
  getMatrix: vi.fn(),
  getPerson: vi.fn(),
  bulkChange: vi.fn(),
  listUsers: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ Navigate: ({ to }: { to: string }) => <div data-testid="navegou">{to}</div> }));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../api/reportAccess", () => ({
  getReportCatalog: mocks.getReportCatalog,
  getMatrix: mocks.getMatrix,
  getPerson: mocks.getPerson,
  bulkChange: mocks.bulkChange,
}));
vi.mock("../api/users", () => ({ listUsers: mocks.listUsers }));

function renderPage(globais: string[]) {
  const me: MyAccess = { is_admin: false, global_permissions: globais, workspace_permissions: {} };
  return render(
    <AccessContext.Provider value={buildAccess(me)}>
      <ReportAccess />
    </AccessContext.Provider>,
  );
}

const catalog = {
  permissions: [
    { key: "relatorio.ver", label: "Ver o relatório", description: "", feature: null, feature_label: null, requires: [] },
    { key: "relatorio.exportar", label: "Exportar por e-mail", description: "", feature: null, feature_label: null, requires: ["relatorio.ver"] },
  ],
  presets: { leitor: ["relatorio.ver"], "leitor-exportador": ["relatorio.ver", "relatorio.exportar"] },
};

function matrix() {
  return {
    groups: [{ id: 7, name: "Turma de dados" }],
    rows: [
      {
        report: { id: 1, name: "Resultado", collection_id: 2, collection_name: "Financeiro", in_root: false },
        cells: { "7": { direct: ["relatorio.exportar", "relatorio.ver"], inherited: [] } },
      },
      {
        report: { id: 2, name: "Fluxo", collection_id: 9, collection_name: "Raiz", in_root: true },
        cells: { "7": { direct: [], inherited: ["relatorio.ver"] } },
      },
    ],
    total: 2,
    page: 1,
    page_size: 25,
  };
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.getReportCatalog.mockResolvedValue(catalog);
  mocks.getMatrix.mockResolvedValue(matrix());
  mocks.listUsers.mockResolvedValue([{ id: 5, name: "Ana", email: "ana@example.com", groups: [], last_login: null, is_blocked: false }]);
  mocks.bulkChange.mockResolvedValue({ reports: 2, subjects: 1, changes: 2 });
});

describe("ReportAccess", () => {
  it("sem nenhuma permissao de ver membros, grupos ou editar permissoes, volta para o inicio", () => {
    renderPage(["sistema.geral"]);

    expect(screen.getByTestId("navegou").textContent).toBe("/");
    expect(mocks.getMatrix).not.toHaveBeenCalled();
  });

  it("mostra por grupo o que foi dado no relatorio e o que vem da colecao", async () => {
    renderPage(["permissoes.editar"]);

    expect(await screen.findByText("Resultado")).toBeTruthy();
    expect(screen.getByText("Exportar por e-mail")).toBeTruthy();
    expect(screen.getByText("(pela coleção)")).toBeTruthy();
    expect(screen.getByText("Raiz (não publicado)")).toBeTruthy();
  });

  it("quem so ve nao tem caixas de selecao nem aplica mudancas", async () => {
    renderPage(["membros.ver"]);

    await screen.findByText("Resultado");

    expect(screen.queryByLabelText("Selecionar Resultado")).toBeNull();
  });

  it("seleciona relatorios, avisa que os da Raiz sao publicados e so grava depois de confirmar", async () => {
    renderPage(["permissoes.editar"]);
    await screen.findByText("Resultado");

    fireEvent.click(screen.getByLabelText("Selecionar todos desta página"));
    fireEvent.change(await screen.findByLabelText("Grupo ou pessoa"), { target: { value: "g:7" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(screen.getByText(/passo que os publica/)).toBeTruthy();
    expect(mocks.bulkChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dar acesso" }));

    await waitFor(() =>
      expect(mocks.bulkChange).toHaveBeenCalledWith({ report_ids: [1, 2], group_ids: [7], user_ids: [], permissions: ["relatorio.ver"], mode: "add" }),
    );
    expect(mocks.showToast).toHaveBeenCalledWith("2 acessos alterados.");
  });

  it("tirar acesso avisa que tira tambem o que depende de ver", async () => {
    renderPage(["permissoes.editar"]);
    await screen.findByText("Resultado");

    fireEvent.click(screen.getByLabelText("Selecionar Resultado"));
    fireEvent.change(await screen.findByLabelText("Ação"), { target: { value: "remove" } });
    fireEvent.change(screen.getByLabelText("Grupo ou pessoa"), { target: { value: "u:5" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(screen.getByText(/também tira exportar/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tirar acesso" }));
    await waitFor(() => expect(mocks.bulkChange).toHaveBeenCalledWith(expect.objectContaining({ user_ids: [5], mode: "remove" })));
  });

  it("mostra o erro do servidor quando a mudanca e recusada", async () => {
    mocks.bulkChange.mockRejectedValue({ response: { data: { detail: "Voce so pode dar ou tirar permissoes que voce mesmo tem. Faltam: X" } } });
    renderPage(["permissoes.editar"]);
    await screen.findByText("Resultado");

    fireEvent.click(screen.getByLabelText("Selecionar Resultado"));
    fireEvent.change(await screen.findByLabelText("Grupo ou pessoa"), { target: { value: "g:7" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    fireEvent.click(screen.getByRole("button", { name: "Dar acesso" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.stringMatching(/Faltam/), "error"));
  });

  it("o painel por pessoa diz de onde vem cada acesso", async () => {
    mocks.getPerson.mockResolvedValue({
      user_id: 5,
      name: "Ana",
      is_admin: false,
      truncated: false,
      rows: [{ report: { id: 1, name: "Resultado", collection_id: 2, collection_name: "Financeiro", in_root: false }, permissions: ["relatorio.ver"], sources: ["Grupo Turma de dados"] }],
    });
    renderPage(["membros.ver"]);
    await screen.findByText("Resultado");

    fireEvent.click(screen.getByRole("tab", { name: "O que uma pessoa vê" }));
    fireEvent.change(await screen.findByLabelText("Pessoa"), { target: { value: "5" } });

    expect(await screen.findByText("Grupo Turma de dados")).toBeTruthy();
    expect(mocks.getPerson).toHaveBeenCalledWith(5);
  });

  it("administrador da plataforma aparece como quem ve tudo", async () => {
    mocks.getPerson.mockResolvedValue({ user_id: 5, name: "Ana", is_admin: true, truncated: false, rows: [] });
    renderPage(["membros.ver"]);
    await screen.findByText("Resultado");

    fireEvent.click(screen.getByRole("tab", { name: "O que uma pessoa vê" }));
    fireEvent.change(await screen.findByLabelText("Pessoa"), { target: { value: "5" } });

    expect(await screen.findByText(/vê todos os relatórios/)).toBeTruthy();
  });
});

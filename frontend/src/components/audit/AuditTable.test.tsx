import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuditTable from "./AuditTable";

const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("../../api/audit", () => ({ searchAuditLogs: mocks.search }));

function entry(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: 1,
    user_name: "Ana Lima",
    user_email: "ana@example.com",
    workspace_id: null,
    workspace_name: null,
    action: "login",
    action_label: "Login",
    entity: "user",
    entity_label: "Usuario",
    entity_id: "1",
    details: null,
    created_at: "2026-11-10T15:00:00Z",
    ...over,
  };
}

function page(items: ReturnType<typeof entry>[], total = items.length, pageNumber = 1) {
  return { items, total, page: pageNumber, page_size: 25 };
}

beforeEach(() => {
  mocks.search.mockReset();
});

describe("AuditTable", () => {
  it("mostra os registros com o nome da acao em portugues e quem fez", async () => {
    mocks.search.mockResolvedValue(
      page([
        entry(1),
        entry(2, { action: "login_blocked", action_label: "Login bloqueado" }),
        entry(3, { user_id: null, user_name: null, user_email: null, action: "apply_update", action_label: "Atualizacao do sistema aplicada" }),
      ]),
    );
    render(<AuditTable filters={{}} timezone="America/Sao_Paulo" />);

    expect(await screen.findByText("Login bloqueado")).toBeTruthy();
    expect(screen.getAllByText("Ana Lima").length).toBe(2);
    expect(screen.getByText("Sistema")).toBeTruthy();
    // A acao e texto comum, igual as outras colunas: sem etiqueta com borda e preenchimento
    expect(screen.getByText("Login bloqueado").className).toBe("cell-filter");
    expect(document.querySelector("[class*='audit-badge']")).toBeNull();
    expect(screen.getByText("1-3 de 3")).toBeTruthy();
  });

  it("acao e recurso ficam em colunas separadas, com o recurso em portugues", async () => {
    mocks.search.mockResolvedValue(
      page([
        entry(1, { action: "view_report", action_label: "Relatorio aberto", entity: "report", entity_label: "Relatorio" }),
        entry(2, { action: "view_collection", action_label: "Colecao visitada", entity: "workspace", entity_label: "Colecao" }),
        entry(3, { action: "update", action_label: "Atualizado", entity: "tipo_novo", entity_label: null }),
      ]),
    );
    render(<AuditTable filters={{}} />);
    await screen.findByText("Relatorio aberto");

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Quando", "Quem", "Acao", "Recurso", "Onde", "Detalhes"]);

    const rows = screen.getAllByRole("row").slice(1);
    const cells = (row: HTMLElement) => Array.from(row.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells(rows[0])[2]).toBe("Relatorio aberto");
    expect(cells(rows[0])[3]).toBe("Relatorio");
    expect(cells(rows[1])[3]).toBe("Colecao");
    expect(cells(rows[2])[3]).toBe("tipo_novo"); // recurso desconhecido aparece como veio
  });

  it("nao ha coluna de email: o email fica no cartao do nome, que abre ao passar o cursor", async () => {
    const onFilterBy = vi.fn();
    mocks.search.mockResolvedValue(page([entry(1)]));
    render(
      <AuditTable
        filters={{}}
        onFilterBy={onFilterBy}
        people={[
          {
            id: 1,
            name: "Ana Lima",
            email: "ana@example.com",
            is_platform_admin: false,
            groups: ["Todos os usuarios"],
            created_at: null,
            last_login_at: null,
            login_provider: "password",
            picture_url: null,
          },
        ]}
      />,
    );
    await screen.findByText("Login");
    expect(screen.queryByRole("columnheader", { name: /email/i })).toBeNull();
    expect(screen.queryByText("ana@example.com")).toBeNull();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Ana Lima" }));

    expect(screen.getByRole("group", { name: "Detalhes de Ana Lima" }).textContent).toContain("ana@example.com");
    fireEvent.click(screen.getByRole("button", { name: /Filtrar por esta pessoa/ }));
    expect(onFilterBy).toHaveBeenCalledWith({ userIds: ["1"] });
  });

  it("clicar no valor de uma coluna filtra por ele: acao, recurso, colecao e dia", async () => {
    const onFilterBy = vi.fn();
    mocks.search.mockResolvedValue(
      page([
        entry(1, {
          action: "view_report",
          action_label: "Relatorio aberto",
          entity: "report",
          entity_label: "Relatorio",
          workspace_id: 2,
          workspace_name: "Financeiro",
          created_at: "2026-11-11T02:00:00Z", // ainda e dia 10 em Sao Paulo (UTC-3)
        }),
      ]),
    );
    render(<AuditTable filters={{}} onFilterBy={onFilterBy} timezone="America/Sao_Paulo" />);
    await screen.findByText("Relatorio aberto");

    fireEvent.click(screen.getByRole("button", { name: "Relatorio aberto" }));
    expect(onFilterBy).toHaveBeenLastCalledWith({ actions: ["view_report"] });

    fireEvent.click(screen.getByRole("button", { name: "Relatorio" }));
    expect(onFilterBy).toHaveBeenLastCalledWith({ entities: ["report"] });

    fireEvent.click(screen.getByRole("button", { name: "Financeiro" }));
    expect(onFilterBy).toHaveBeenLastCalledWith({ workspaceIds: ["2"] });

    fireEvent.click(screen.getByTitle("Filtrar por este dia"));
    expect(onFilterBy).toHaveBeenLastCalledWith({ period: "custom", customFrom: "2026-11-10", customTo: "2026-11-10" });
  });

  it("cada valor clicavel avisa o que faz ao passar o cursor", async () => {
    mocks.search.mockResolvedValue(page([entry(1, { workspace_id: 2, workspace_name: "Financeiro", details: "Relatorio de vendas" })]));
    render(<AuditTable filters={{}} />);
    await screen.findByText("Login");

    for (const hint of [
      "Filtrar por este dia",
      "Filtrar por esta acao",
      "Filtrar por este recurso",
      "Filtrar por esta colecao",
      "Buscar por este texto",
    ]) {
      expect(screen.getByTitle(hint)).toBeTruthy();
    }
  });

  it("sem colecao a celula Onde mostra so o traco, sem filtro", async () => {
    mocks.search.mockResolvedValue(page([entry(1, { workspace_id: null, workspace_name: null })]));
    render(<AuditTable filters={{}} />);
    await screen.findByText("Login");

    expect(screen.getByText("--")).toBeTruthy();
    expect(screen.queryByTitle("Filtrar por esta colecao")).toBeNull();
  });

  it("clicar no detalhe poe o texto na busca e busca por ele", async () => {
    mocks.search.mockResolvedValue(page([entry(1, { action: "update", action_label: "Atualizado", details: "Relatorio de vendas" })]));
    render(<AuditTable filters={{}} />);
    await screen.findByText("Atualizado");
    mocks.search.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Relatorio de vendas" }));

    expect((screen.getByLabelText("Buscar na auditoria") as HTMLInputElement).value).toBe("Relatorio de vendas");
    await waitFor(() => expect(mocks.search).toHaveBeenCalledWith({}, "Relatorio de vendas", 1, 25));
  });

  it("detalhe vazio nao vira botao", async () => {
    mocks.search.mockResolvedValue(page([entry(1, { details: null })]));
    render(<AuditTable filters={{}} />);
    await screen.findByText("Login");
    expect(screen.queryByTitle("Buscar por este texto")).toBeNull();
  });

  it("a busca por texto vai com o email digitado ao servidor", async () => {
    mocks.search.mockResolvedValue(page([entry(1)]));
    render(<AuditTable filters={{}} />);
    await screen.findByText("Login");
    mocks.search.mockClear();

    fireEvent.change(screen.getByLabelText("Buscar na auditoria"), { target: { value: "ana@example.com" } });

    await waitFor(() => expect(mocks.search).toHaveBeenCalledWith({}, "ana@example.com", 1, 25));
  });

  it("login pelo Google fica legivel nos detalhes", async () => {
    mocks.search.mockResolvedValue(page([entry(1, { details: "google" })]));
    render(<AuditTable filters={{}} />);
    expect(await screen.findByText("Entrou pelo Google")).toBeTruthy();
  });

  it("usuario removido aparece pelo email gravado", async () => {
    mocks.search.mockResolvedValue(page([entry(1, { user_id: null, user_name: null, user_email: "saiu@example.com" })]));
    render(<AuditTable filters={{}} />);
    expect(await screen.findByText("saiu@example.com")).toBeTruthy();
  });

  it("a busca espera a pessoa parar de digitar e manda o texto ao servidor", async () => {
    mocks.search.mockResolvedValue(page([entry(1)]));
    render(<AuditTable filters={{}} />);
    await screen.findByText("Ana Lima");
    mocks.search.mockClear();

    const input = screen.getByLabelText("Buscar na auditoria");
    fireEvent.change(input, { target: { value: "b" } });
    fireEvent.change(input, { target: { value: "bloq" } });

    await waitFor(() => expect(mocks.search).toHaveBeenCalledWith({}, "bloq", 1, 25));
    expect(mocks.search).toHaveBeenCalledTimes(1); // so a ultima digitacao busca
  });

  it("os filtros vao para o servidor e mudar de filtro volta para a pagina 1", async () => {
    mocks.search.mockResolvedValue(page([entry(1)], 60));
    const { rerender } = render(<AuditTable filters={{ action: ["login"] }} />);
    await screen.findByText("1-25 de 60");

    fireEvent.click(screen.getByRole("button", { name: "Proxima" }));
    await waitFor(() => expect(mocks.search).toHaveBeenLastCalledWith({ action: ["login"] }, "", 2, 25));

    rerender(<AuditTable filters={{ action: ["login"], user_id: [5, 6] }} />);
    await waitFor(() =>
      expect(mocks.search).toHaveBeenLastCalledWith({ action: ["login"], user_id: [5, 6] }, "", 1, 25),
    );
  });

  it("pagina: Anterior desabilitado na primeira e Proxima na ultima", async () => {
    mocks.search.mockResolvedValue(page([entry(1)], 26));
    render(<AuditTable filters={{}} />);
    await screen.findByText("1-25 de 26");

    expect((screen.getByRole("button", { name: "Anterior" }) as HTMLButtonElement).disabled).toBe(true);
    mocks.search.mockResolvedValue(page([entry(2)], 26, 2));
    fireEvent.click(screen.getByRole("button", { name: "Proxima" }));

    await screen.findByText("26-26 de 26");
    expect((screen.getByRole("button", { name: "Proxima" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sem resultado e com erro mostra mensagem clara", async () => {
    mocks.search.mockResolvedValue(page([], 0));
    const { unmount } = render(<AuditTable filters={{}} />);
    expect(await screen.findByText("Nenhum registro encontrado com esses filtros.")).toBeTruthy();
    unmount();

    mocks.search.mockRejectedValue(new Error("falhou"));
    render(<AuditTable filters={{}} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

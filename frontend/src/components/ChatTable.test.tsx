import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatTable as ChatTableData } from "../api/aiChat";
import ChatTable from "./ChatTable";

const tabela = (extra: Partial<ChatTableData> = {}): ChatTableData => ({
  columns: ["Vendas[Mes]", "[Total]"],
  rows: [
    { "Vendas[Mes]": "Janeiro", "[Total]": 1234.5 },
    { "Vendas[Mes]": "Fevereiro", "[Total]": null },
  ],
  total_rows: 2,
  truncated: false,
  ...extra,
});

describe("ChatTable", () => {
  it("mostra o nome limpo de cada coluna e guarda o completo na dica", () => {
    render(<ChatTable table={tabela()} />);

    const cabecalho = screen.getAllByRole("columnheader");
    expect(cabecalho.map((c) => c.textContent)).toEqual(["Mes", "Total"]);
    expect(cabecalho[0].getAttribute("title")).toBe("Vendas[Mes]");
  });

  it("formata os valores no padrao brasileiro e vazio como traco", () => {
    render(<ChatTable table={tabela()} />);

    const linhas = screen.getAllByRole("row").slice(1);
    expect(within(linhas[0]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Janeiro", "1.234,5"]);
    expect(within(linhas[1]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Fevereiro", "-"]);
  });

  it("alinha numeros a direita", () => {
    render(<ChatTable table={tabela()} />);

    expect(screen.getByText("1.234,5").className).toContain("chat-table-number");
    expect(screen.getByText("Janeiro").className).not.toContain("chat-table-number");
  });

  it("conta as linhas", () => {
    render(<ChatTable table={tabela()} />);

    expect(screen.getByText("2 linhas.")).toBeTruthy();
  });

  it("uma linha so fica no singular", () => {
    render(<ChatTable table={tabela({ rows: [{ "Vendas[Mes]": "Janeiro", "[Total]": 1 }], total_rows: 1 })} />);

    expect(screen.getByText("1 linha.")).toBeTruthy();
  });

  it("avisa quando o resultado foi cortado", () => {
    render(<ChatTable table={tabela({ total_rows: 500, truncated: true })} />);

    expect(screen.getByText("Mostrando as primeiras 2 de 500 linhas.")).toBeTruthy();
  });

  it("sem linhas mostra o aviso e nenhuma tabela", () => {
    render(<ChatTable table={tabela({ rows: [], total_rows: 0 })} />);

    expect(screen.getByText("A consulta nao devolveu linhas.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("texto que parece HTML entra como texto, sem virar elemento", () => {
    const { container } = render(
      <ChatTable table={tabela({ rows: [{ "Vendas[Mes]": "<img src=x onerror=alert(1)>", "[Total]": 1 }], total_rows: 1 })} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });
});

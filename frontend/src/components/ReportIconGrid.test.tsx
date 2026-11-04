import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { makeReport } from "../test-fixtures";
import ReportIconGrid from "./ReportIconGrid";

// O stub deixa visivel como o LazyMount foi chamado, sem precisar de IntersectionObserver
vi.mock("./LazyMount", () => ({
  default: ({ children, unmountWhenHidden }: { children: ReactNode; unmountWhenHidden?: boolean }) => (
    <div data-testid="lazy" data-desmonta={String(Boolean(unmountWhenHidden))}>
      {children}
    </div>
  ),
}));
vi.mock("./ReportThumbnail", () => ({ default: ({ reportId }: { reportId: number }) => <i data-testid={`thumb-${reportId}`} /> }));

const REPORTS = [makeReport(1, { name: "Vendas" }), makeReport(2, { name: "Estoque" })];

describe("ReportIconGrid", () => {
  it("as miniaturas vivas sao desmontadas quando saem da tela", () => {
    render(<ReportIconGrid reports={REPORTS} onOpenFullscreen={vi.fn()} renderActions={() => null} />);

    const envolturas = screen.getAllByTestId("lazy");
    expect(envolturas).toHaveLength(2);
    expect(envolturas.every((e) => e.getAttribute("data-desmonta") === "true")).toBe(true);
  });

  it("clicar no cartao abre o relatorio em tela cheia", () => {
    const abrir = vi.fn();
    render(<ReportIconGrid reports={REPORTS} onOpenFullscreen={abrir} renderActions={() => null} />);

    fireEvent.click(screen.getByText("Estoque").closest('[role="button"]') as HTMLElement);

    expect(abrir).toHaveBeenCalledWith(2);
  });

  it("clicar nas acoes do cartao nao abre a tela cheia", () => {
    const abrir = vi.fn();
    render(
      <ReportIconGrid
        reports={REPORTS}
        onOpenFullscreen={abrir}
        renderActions={(report) => <button>acao {report.id}</button>}
      />,
    );

    fireEvent.click(screen.getByText("acao 1"));

    expect(abrir).not.toHaveBeenCalled();
  });
});

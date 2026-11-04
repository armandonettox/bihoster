import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeReport } from "../test-fixtures";
import FullscreenReportView from "./FullscreenReportView";

vi.mock("../context/BrandingContext", () => ({ useBranding: () => ({ settings: null }) }));
vi.mock("./ReportEmbed", () => ({
  default: ({ reportId }: { reportId: number }) => <div data-testid="embed">{`embed ${reportId}`}</div>,
}));

const REPORTS = [makeReport(1, { name: "Painel Norte" }), makeReport(2, { name: "Painel Sul" })];

function abrir(onExit = vi.fn(), mode: "tv" | "apresentacao" = "apresentacao") {
  render(<FullscreenReportView mode={mode} reports={REPORTS} tvIntervalSeconds={15} onExit={onExit} />);
  return onExit;
}

describe("FullscreenReportView", () => {
  it("mostra a logo e o nome do relatorio, porque o conteudo troca de um para outro", () => {
    abrir();

    expect(screen.getByText("Painel Norte")).toBeTruthy();
    expect(screen.getAllByRole("img", { name: "BIHoster" }).length).toBeGreaterThan(0);
    expect(screen.getByTestId("embed").textContent).toBe("embed 1");
  });

  it("nao mostra mais o nome da colecao no cabecalho", () => {
    abrir();

    expect(screen.queryByText("Colecao Vendas")).toBeNull();
  });

  it("a seta para a frente passa para o proximo relatorio", () => {
    abrir();

    fireEvent.keyDown(document, { key: "ArrowRight" });

    expect(screen.getByText("Painel Sul")).toBeTruthy();
    expect(screen.getByTestId("embed").textContent).toBe("embed 2");
  });

  it("o botao Sair, com icone e a tecla Esc, chama onExit", () => {
    const sair = abrir();

    fireEvent.click(screen.getByRole("button", { name: "Sair da tela cheia (Esc)" }));

    expect(sair).toHaveBeenCalledTimes(1);
  });

  it("o Esc tambem sai", () => {
    const sair = abrir();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(sair).toHaveBeenCalledTimes(1);
  });

  it("secao sem relatorios avisa e deixa sair", () => {
    const sair = vi.fn();
    render(<FullscreenReportView mode="tv" reports={[]} onExit={sair} />);

    expect(screen.getByText("Nenhum relatorio nesta secao ainda.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(sair).toHaveBeenCalledTimes(1);
  });
});

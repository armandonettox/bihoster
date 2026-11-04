import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ReportRefreshInfo from "./ReportRefreshInfo";

describe("ReportRefreshInfo", () => {
  it("nao mostra nada sem info", () => {
    const { container } = render(<ReportRefreshInfo />);
    expect(container.firstChild).toBeNull();
  });

  it("nao mostra nada quando a info vem vazia", () => {
    const { container } = render(<ReportRefreshInfo info={{ last_refresh: null, next_refresh: null }} />);
    expect(container.firstChild).toBeNull();
  });

  it("mostra so a ultima atualizacao quando nao ha proxima", () => {
    render(<ReportRefreshInfo info={{ last_refresh: "2026-11-03T12:00:00Z", next_refresh: null }} />);

    expect(screen.getByText(/Ultima atualizacao/)).toBeTruthy();
    expect(screen.queryByText(/Proxima/)).toBeNull();
  });

  it("mostra a ultima e a proxima, separadas", () => {
    render(
      <ReportRefreshInfo info={{ last_refresh: "2026-11-03T12:00:00Z", next_refresh: "2026-11-04T12:00:00Z" }} />,
    );

    const texto = screen.getByText(/Ultima atualizacao/).textContent ?? "";
    expect(texto).toContain("Proxima");
    expect(texto).toContain("·");
  });
});

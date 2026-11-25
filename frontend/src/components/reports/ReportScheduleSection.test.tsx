import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../../api/access";
import { AccessContext, buildAccess } from "../../context/AccessContext";
import ReportScheduleSection from "./ReportScheduleSection";

vi.mock("../ScheduleEditor", () => ({ default: ({ kind, id }: { kind: string; id: number }) => <div data-testid="editor">{`${kind}:${id}`}</div> }));

function renderSection(me: Partial<MyAccess>) {
  return render(
    <AccessContext.Provider value={buildAccess({ is_admin: false, global_permissions: [], workspace_permissions: {}, ...me })}>
      <ReportScheduleSection reportId={12} />
    </AccessContext.Provider>,
  );
}

describe("ReportScheduleSection", () => {
  it("so aparece para quem pode definir horarios", () => {
    renderSection({ global_permissions: ["relatorio.ver"] });

    expect(screen.queryByText("Horário de acesso do relatório")).toBeNull();
  });

  it("nao aparece fora de um provedor de acesso", () => {
    render(<ReportScheduleSection reportId={12} />);

    expect(screen.queryByText("Horário de acesso do relatório")).toBeNull();
  });

  it("o editor so carrega depois de abrir a secao", () => {
    renderSection({ global_permissions: ["membros.horario"] });
    expect(screen.queryByTestId("editor")).toBeNull();

    const detalhes = screen.getByText("Horário de acesso do relatório").closest("details") as HTMLDetailsElement;
    detalhes.open = true;
    fireEvent(detalhes, new Event("toggle"));

    expect(screen.getByTestId("editor").textContent).toBe("report:12");
  });
});

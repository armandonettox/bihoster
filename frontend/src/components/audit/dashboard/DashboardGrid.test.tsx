import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditSummary, DashboardWidget } from "../../../api/audit";
import DashboardGrid from "./DashboardGrid";
import { applyLayout } from "./gridLayout";

const mocks = vi.hoisted(() => ({
  width: 1200,
  mounted: true,
  gridProps: null as null | Record<string, any>,
}));

// A biblioteca mede o contêiner e usa ResizeObserver, que o jsdom nao tem: aqui ela e trocada por
// uma peca que so repassa o que a tela entrega, para testar o que e nosso (layout, regras e callbacks)
vi.mock("react-grid-layout", () => ({
  default: (props: Record<string, any> & { children: ReactNode }) => {
    mocks.gridProps = props;
    return <div data-testid="grid">{props.children}</div>;
  },
  useContainerWidth: () => ({ width: mocks.width, containerRef: { current: null }, mounted: mocks.mounted }),
}));
vi.mock("react-grid-layout/css/styles.css", () => ({}));
vi.mock("react-resizable/css/styles.css", () => ({}));

const SUMMARY = {
  totals: { events: 5, active_users: 1, logins_ok: 1, logins_blocked: 0, accounts_locked: 0 },
  by_day: [],
  by_hour: Array(24).fill(0),
  by_action: [],
  top_users: [],
  top_collections: [],
  top_reports: [],
  login_methods: { password: 0, google: 0 },
  timezone: "UTC",
} as AuditSummary;

const WIDGETS: DashboardWidget[] = [
  { id: "a", type: "stat", source: "events", title: null, x: 0, y: 0, w: 4, h: 2 },
  { id: "b", type: "line", source: "by_day", title: "Linha", x: 0, y: 2, w: 20, h: 6 },
];

beforeEach(() => {
  mocks.width = 1200;
  mocks.mounted = true;
  mocks.gridProps = null;
});

describe("applyLayout", () => {
  it("devolve posicao e tamanho novos para cada visual e mantem o resto", () => {
    const next = applyLayout(WIDGETS, [
      { i: "a", x: 4, y: 0, w: 6, h: 3 },
      { i: "b", x: 0, y: 3, w: 12, h: 5 },
    ]);

    expect(next[0]).toMatchObject({ id: "a", x: 4, y: 0, w: 6, h: 3, source: "events" });
    expect(next[1]).toMatchObject({ id: "b", x: 0, y: 3, w: 12, h: 5, title: "Linha" });
  });

  it("visual que a grade nao devolveu fica como estava", () => {
    const next = applyLayout(WIDGETS, [{ i: "a", x: 1, y: 1, w: 4, h: 2 }]);
    expect(next[1]).toEqual(WIDGETS[1]);
  });
});

describe("DashboardGrid", () => {
  const render20 = (editing: boolean, onChange = vi.fn()) =>
    render(<DashboardGrid widgets={WIDGETS} columns={20} summary={SUMMARY} editing={editing} onChange={onChange} />);

  it("passa a grade de 20 colunas e o layout de cada visual, com tamanho minimo por tipo", () => {
    render20(false);
    const props = mocks.gridProps!;

    expect(props.gridConfig.cols).toBe(20);
    expect(props.layout).toEqual([
      { i: "a", x: 0, y: 0, w: 4, h: 2, minW: 3, minH: 2 },
      { i: "b", x: 0, y: 2, w: 20, h: 6, minW: 6, minH: 4 },
    ]);
  });

  it("arrastar e redimensionar so ficam ligados no modo de edicao, pelo titulo e por borda e canto", () => {
    render20(false);
    expect(mocks.gridProps!.dragConfig.enabled).toBe(false);
    expect(mocks.gridProps!.resizeConfig.enabled).toBe(false);

    render20(true);
    expect(mocks.gridProps!.dragConfig).toEqual({ enabled: true, handle: ".dash-drag" });
    expect(mocks.gridProps!.resizeConfig).toEqual({ enabled: true, handles: ["s", "e", "se"] });
  });

  it("na edicao, mudar o layout avisa com os visuais ja atualizados", () => {
    const onChange = vi.fn();
    render20(true, onChange);

    mocks.gridProps!.onLayoutChange([
      { i: "a", x: 8, y: 0, w: 4, h: 2 },
      { i: "b", x: 0, y: 2, w: 20, h: 6 },
    ]);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ id: "a", x: 8 });
  });

  it("fora da edicao a grade pode se reorganizar sozinha sem alterar nada", () => {
    const onChange = vi.fn();
    render20(false, onChange);

    mocks.gridProps!.onLayoutChange([{ i: "a", x: 9, y: 9, w: 4, h: 2 }]);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("desenha um visual por widget", () => {
    render20(false);
    expect(screen.getByText("Eventos")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Linha" })).toBeTruthy();
  });

  it("espera a medida do contêiner antes de montar a grade", () => {
    mocks.mounted = false;
    render20(false);
    expect(screen.queryByTestId("grid")).toBeNull();
  });

  it("em tela estreita os visuais empilham na ordem de leitura e nao ha edicao", () => {
    mocks.width = 600;
    const reversed = [...WIDGETS].reverse();
    const { container } = render(
      <DashboardGrid widgets={reversed} columns={20} summary={SUMMARY} editing={true} onChange={vi.fn()} />,
    );

    expect(screen.queryByTestId("grid")).toBeNull();
    const items = container.querySelectorAll(".dash-stack .dash-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Eventos"); // y menor primeiro, mesmo com a lista invertida
    expect(container.querySelector(".dash-drag")).toBeNull();
  });
});

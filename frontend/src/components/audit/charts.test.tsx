import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BarList, Donut, HourChart, LineChart } from "./charts";

const unit = (n: number) => `${n} eventos`;

const hover = (el: Element, x = 100, y = 100) => fireEvent.mouseEnter(el, { clientX: x, clientY: y });
const tooltip = () => screen.getByRole("tooltip");

describe("BarList", () => {
  const items = [
    { key: "login", label: "Login", value: 75, hint: "ana@example.com" },
    { key: "view_report", label: "Relatorio aberto", value: 25 },
  ];

  it("ao passar o cursor mostra o rotulo com o nome, o valor e a participacao, e some ao sair", () => {
    render(<BarList items={items} unit={unit} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    const row = screen.getByText("Login").closest("li")!; // antes do rotulo abrir, que repete o nome

    hover(row);

    expect(within(tooltip()).getByText("Login")).toBeTruthy();
    expect(within(tooltip()).getByText("75 eventos (75%)")).toBeTruthy();
    expect(within(tooltip()).getByText("ana@example.com")).toBeTruthy(); // a dica do item entra no rotulo

    fireEvent.mouseLeave(row);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("o rotulo segue o cursor", () => {
    render(<BarList items={items} unit={unit} />);
    const row = screen.getByText("Login").closest("li")!;
    hover(row, 100, 50);
    const first = (tooltip() as HTMLElement).style.left;

    fireEvent.mouseMove(row, { clientX: 300, clientY: 80 });

    expect((tooltip() as HTMLElement).style.left).not.toBe(first);
  });

  it("perto da borda direita o rotulo abre para a esquerda do cursor", () => {
    render(<BarList items={items} unit={unit} />);
    hover(screen.getByText("Login").closest("li")!, window.innerWidth - 10, 50);

    const style = (tooltip() as HTMLElement).style;
    expect(style.right).not.toBe("");
    expect(style.left).toBe("");
  });

  it("um item so mostra o valor, sem porcentagem", () => {
    render(<BarList items={[items[0]]} unit={unit} />);
    hover(screen.getByText("Login").closest("li")!);
    expect(within(tooltip()).getByText("75 eventos")).toBeTruthy();
  });

  it("sem onSelect nao ha botoes nem convite para clicar", () => {
    render(<BarList items={items} unit={unit} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);

    hover(screen.getByText("Login").closest("li")!);
    expect(within(tooltip()).queryByText(/Clique/)).toBeNull();
  });

  it("com onSelect cada linha e um botao que entrega a chave, e o rotulo convida a clicar", () => {
    const onSelect = vi.fn();
    render(<BarList items={items} unit={unit} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /Relatorio aberto/ }));
    expect(onSelect).toHaveBeenCalledWith("view_report");

    hover(screen.getByText("Login").closest("li")!);
    expect(within(tooltip()).getByText(/Clique para filtrar/)).toBeTruthy();
  });

  it("o item selecionado fica destacado, os outros esmaecem e o rotulo convida a tirar o filtro", () => {
    const { container } = render(<BarList items={items} unit={unit} onSelect={vi.fn()} selected={["login"]} />);

    const [login, report] = Array.from(container.querySelectorAll("li"));
    expect(login.className).toContain("chart-selected");
    expect(login.className).not.toContain("chart-dim");
    expect(report.className).toContain("chart-dim");

    hover(login);
    expect(within(tooltip()).getByText(/Clique para tirar o filtro/)).toBeTruthy();
  });

  it("nada selecionado: nenhum item esmaece", () => {
    const { container } = render(<BarList items={items} unit={unit} onSelect={vi.fn()} selected={[]} />);
    expect(container.querySelector(".chart-dim")).toBeNull();
    expect(container.querySelector(".chart-selected")).toBeNull();
  });
});

describe("LineChart", () => {
  const data = [
    { label: "2026-11-09", value: 3 },
    { label: "2026-11-10", value: 5 },
  ];
  const describe_ = (n: number) => `${n} eventos`;

  it("cada ponto mostra o dia e o valor ao passar o cursor", () => {
    const { container } = render(<LineChart data={data} describe={describe_} />);

    hover(container.querySelectorAll("rect.audit-line-hit")[1]);

    expect(within(tooltip()).getByText("10/11")).toBeTruthy();
    expect(within(tooltip()).getByText("5 eventos")).toBeTruthy();
  });

  it("rotulo de ponto que nao e data usa o formatador escolhido", () => {
    const { container } = render(
      <LineChart data={[{ label: "9h", value: 2 }]} describe={describe_} formatLabel={(label) => `as ${label}`} />,
    );
    hover(container.querySelector("rect.audit-line-hit")!);
    expect(within(tooltip()).getByText("as 9h")).toBeTruthy();
  });

  it("clicar num ponto entrega a data; o ponto selecionado fica marcado", () => {
    const onSelect = vi.fn();
    const { container } = render(<LineChart data={data} describe={describe_} onSelect={onSelect} selected={["2026-11-09"]} />);
    const hits = container.querySelectorAll("rect.audit-line-hit");

    fireEvent.click(hits[1]);

    expect(onSelect).toHaveBeenCalledWith("2026-11-10");
    expect(hits[0].getAttribute("class")).toContain("chart-selected");
    expect(hits[1].getAttribute("class")).not.toContain("chart-selected");
    expect(hits[1].getAttribute("class")).toContain("chart-clickable");
  });

  it("sem onSelect o ponto nao e clicavel", () => {
    const { container } = render(<LineChart data={data} describe={describe_} />);
    expect(container.querySelector(".chart-clickable")).toBeNull();
  });
});

describe("HourChart", () => {
  it("cada coluna mostra a hora e o valor ao passar o cursor", () => {
    const values = Array.from({ length: 24 }, (_, h) => (h === 9 ? 7 : 0));
    const { container } = render(<HourChart values={values} describe={(_hour, n) => `${n} eventos`} />);

    hover(container.querySelectorAll(".audit-hours-col")[9]);

    expect(within(tooltip()).getByText("9h")).toBeTruthy();
    expect(within(tooltip()).getByText("7 eventos")).toBeTruthy();
  });
});

describe("Donut", () => {
  const parts = [
    { key: "password", label: "Email e senha", value: 60, color: "red" },
    { key: "google", label: "Google", value: 40, color: "blue" },
  ];

  it("a fatia mostra o nome, o valor e a porcentagem ao passar o cursor", () => {
    const { container } = render(<Donut parts={parts} centerLabel="logins" emptyText="Sem dados." />);

    hover(container.querySelectorAll("circle.audit-donut-slice")[1]);

    expect(within(tooltip()).getByText("Google")).toBeTruthy();
    expect(within(tooltip()).getByText("40 (40%)")).toBeTruthy();
  });

  it("a legenda tambem mostra o rotulo", () => {
    render(<Donut parts={parts} centerLabel="logins" emptyText="Sem dados." />);
    hover(screen.getByText("Email e senha").closest("li")!);
    expect(within(tooltip()).getByText("60 (60%)")).toBeTruthy();
  });

  it("clicar na fatia ou na legenda entrega a chave; a selecionada e destacada e as outras esmaecem", () => {
    const onSelect = vi.fn();
    const { container } = render(<Donut parts={parts} centerLabel="logins" emptyText="Sem dados." onSelect={onSelect} selected={["google"]} />);
    const slices = container.querySelectorAll("circle.audit-donut-slice");

    fireEvent.click(slices[0]);
    fireEvent.click(screen.getByRole("button", { name: /Google/ }));

    expect(onSelect).toHaveBeenNthCalledWith(1, "password");
    expect(onSelect).toHaveBeenNthCalledWith(2, "google");
    expect(slices[1].getAttribute("class")).toContain("chart-selected");
    expect(slices[0].getAttribute("class")).toContain("chart-dim");
  });

  it("sem onSelect a legenda nao tem botoes", () => {
    render(<Donut parts={parts} centerLabel="logins" emptyText="Sem dados." />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("sem dados mostra o texto vazio", () => {
    render(<Donut parts={parts.map((p) => ({ ...p, value: 0 }))} centerLabel="logins" emptyText="Nenhum login." />);
    expect(screen.getByText("Nenhum login.")).toBeTruthy();
  });
});

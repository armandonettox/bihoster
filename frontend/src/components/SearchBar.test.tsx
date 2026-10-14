import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResultEntry } from "../api/search";
import SearchBar from "./SearchBar";

const mocks = vi.hoisted(() => ({
  searchReports: vi.fn(),
  selectWorkspace: vi.fn(),
  navigate: vi.fn(),
  currentWorkspace: { id: 99 } as { id: number } | null,
}));

vi.mock("../api/search", () => ({ searchReports: mocks.searchReports }));
vi.mock("../context/WorkspaceContext", () => ({
  useWorkspace: () => ({ selectWorkspace: mocks.selectWorkspace, currentWorkspace: mocks.currentWorkspace }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));

const COLLECTION: SearchResultEntry = {
  id: 7,
  name: "Gestão",
  kind: "colecao",
  display_type: null,
  workspace_id: 7,
  workspace_name: "Gestão",
  workspace_slug: "gestao",
};

const REPORT: SearchResultEntry = {
  id: 21,
  name: "Metas de gestão",
  kind: "relatorio",
  display_type: "relatorio",
  workspace_id: 3,
  workspace_name: "Comercial",
  workspace_slug: "comercial",
};

async function typeAndWaitForResults(text: string) {
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: text } });
  // A busca tem um atraso de 250 ms antes de ir pra API
  await screen.findByRole("listbox", undefined, { timeout: 2000 });
  return input;
}

beforeEach(() => {
  mocks.searchReports.mockReset();
  mocks.selectWorkspace.mockReset();
  mocks.navigate.mockReset();
  mocks.currentWorkspace = { id: 99 };
});

describe("SearchBar", () => {
  it("mostra colecao e relatorio, cada um com o seu selo", async () => {
    mocks.searchReports.mockResolvedValue([COLLECTION, REPORT]);
    render(<SearchBar />);
    await typeAndWaitForResults("gestao");

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Colecao");
    // Relatorio mostra o nome da colecao a que pertence
    expect(options[1].textContent).toContain("Comercial");
  });

  it("destaca o trecho ignorando acento ('gestao' marca 'Gestão')", async () => {
    mocks.searchReports.mockResolvedValue([COLLECTION]);
    render(<SearchBar />);
    await typeAndWaitForResults("gestao");

    const marks = document.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("Gestão");
  });

  it("clicar numa colecao troca a colecao atual e vai pra ela", async () => {
    mocks.searchReports.mockResolvedValue([COLLECTION, REPORT]);
    render(<SearchBar />);
    await typeAndWaitForResults("gestao");

    fireEvent.click(screen.getAllByRole("option")[0]);

    expect(mocks.selectWorkspace).toHaveBeenCalledWith(7);
    expect(mocks.navigate).toHaveBeenCalledWith("/collection");
  });

  it("Enter sem escolher com as setas abre o primeiro resultado", async () => {
    mocks.searchReports.mockResolvedValue([REPORT, COLLECTION]);
    render(<SearchBar />);
    const input = await typeAndWaitForResults("gestao");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.selectWorkspace).toHaveBeenCalledWith(3);
    expect(mocks.navigate).toHaveBeenCalledWith("/collection");
  });

  it("nao troca de colecao quando o resultado ja e da colecao atual", async () => {
    mocks.currentWorkspace = { id: 7 };
    mocks.searchReports.mockResolvedValue([COLLECTION]);
    render(<SearchBar />);
    await typeAndWaitForResults("gestao");

    fireEvent.click(screen.getByRole("option"));

    expect(mocks.selectWorkspace).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/collection");
  });

  it("sem resultado mostra a mensagem de vazio", async () => {
    mocks.searchReports.mockResolvedValue([]);
    render(<SearchBar />);
    await typeAndWaitForResults("inexistente");

    expect(screen.getByText("Nenhum resultado encontrado.")).toBeTruthy();
  });

  it("falha da API mostra a mensagem de erro, nao a de vazio", async () => {
    mocks.searchReports.mockRejectedValue(new Error("falhou"));
    render(<SearchBar />);
    await typeAndWaitForResults("gestao");

    expect(screen.getByText("Nao foi possivel buscar agora. Tente de novo.")).toBeTruthy();
    expect(screen.queryByText("Nenhum resultado encontrado.")).toBeNull();
  });

  it("resposta de backend antigo, sem 'kind', e tratada como relatorio", async () => {
    const legacy = { ...REPORT } as Partial<SearchResultEntry>;
    delete legacy.kind;
    mocks.searchReports.mockResolvedValue([legacy]);
    render(<SearchBar />);
    await typeAndWaitForResults("metas");

    const option = screen.getByRole("option");
    expect(option.textContent).toContain("Comercial");
    expect(option.textContent).not.toContain("Colecao");
  });
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Panel, PanelEntry } from "../../api/accessPanel";
import PermissionsPanel from "./PermissionsPanel";

const mocks = vi.hoisted(() => ({
  getPanel: vi.fn(),
  putSubject: vi.fn(),
  inviteByEmail: vi.fn(),
  searchSubjects: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../api/accessPanel", () => ({
  getPanel: mocks.getPanel,
  putSubject: mocks.putSubject,
  inviteByEmail: mocks.inviteByEmail,
  searchSubjects: mocks.searchSubjects,
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));

function entry(parts: Partial<PanelEntry> = {}): PanelEntry {
  return {
    subject_kind: "user", subject_id: 5, name: "Ana Souza", email: "ana@example.com", picture_url: null,
    permissions: ["relatorio.ver"], effective: ["relatorio.ver"], preset: "ver", origins: [{ kind: "direct", label: "Direto" }], ...parts,
  };
}

function panel(entries: PanelEntry[]): Panel {
  return {
    item: { kind: "report", id: 10, name: "Resultado", subtitle: "Financeiro" },
    entries,
    presets: [
      { key: "ver", label: "Ver", permissions: ["relatorio.ver"] },
      { key: "exportar", label: "Ver e exportar", permissions: ["relatorio.ver", "relatorio.exportar"] },
      { key: "gerenciar", label: "Gerenciar", permissions: ["relatorio.ver"] },
    ],
    permissions: [
      { key: "relatorio.ver", label: "Ver o relatório", description: "" },
      { key: "relatorio.exportar", label: "Exportar por e-mail", description: "" },
    ],
    can_manage: true,
  };
}

async function abrir(entries: PanelEntry[], onChanged = vi.fn()) {
  mocks.getPanel.mockResolvedValue(panel(entries));
  render(<PermissionsPanel kind="report" itemId={10} itemName="Resultado" onClose={() => {}} onChanged={onChanged} />);
  await screen.findByRole("combobox", { name: "Adicionar pessoas ou grupos" });
  return onChanged;
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.putSubject.mockResolvedValue({ permissions: [], preset: null });
  mocks.searchSubjects.mockResolvedValue([]);
});

describe("PermissionsPanel", () => {
  it("lista quem tem acesso com o preset e de onde vem cada acesso", async () => {
    await abrir([
      entry(),
      entry({ subject_kind: "group", subject_id: 7, name: "Diretoria", email: null, permissions: [], effective: ["relatorio.ver"], preset: null, origins: [{ kind: "folder", label: "Financeiro" }, { kind: "inherited", label: "Herdado de Geral" }] }),
    ]);

    expect(screen.getByText("Ana Souza")).toBeTruthy();
    expect(screen.getByText(/ana@example.com · Direto/)).toBeTruthy();
    expect(screen.getByText(/Grupo · Financeiro · Herdado de Geral/)).toBeTruthy();
    expect((screen.getByLabelText("Acesso de Ana Souza") as HTMLSelectElement).value).toBe("ver");
    expect((screen.getByLabelText("Acesso de Diretoria") as HTMLSelectElement).value).toBe("");
  });

  it("sem ninguem mostra o estado vazio com a acao certa", async () => {
    await abrir([]);

    expect(screen.getByText("Ninguém tem acesso ainda")).toBeTruthy();
    expect(screen.getByText(/Use o campo acima/)).toBeTruthy();
  });

  it("trocar o preset grava na hora, avisa e permite desfazer", async () => {
    const onChanged = await abrir([entry()]);

    fireEvent.change(screen.getByLabelText("Acesso de Ana Souza"), { target: { value: "exportar" } });

    await waitFor(() => expect(mocks.putSubject).toHaveBeenCalledWith("report", 10, "user", 5, { preset: "exportar" }));
    expect(await screen.findByText("Acesso de Ana Souza mudou.")).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(mocks.putSubject).toHaveBeenLastCalledWith("report", 10, "user", 5, { permissions: ["relatorio.ver"] }));
  });

  it("remover o acesso manda lista vazia e o desfazer devolve o que havia", async () => {
    await abrir([entry({ permissions: ["relatorio.ver", "relatorio.exportar"], preset: "exportar" })]);

    fireEvent.change(screen.getByLabelText("Acesso de Ana Souza"), { target: { value: "__remove" } });

    await waitFor(() => expect(mocks.putSubject).toHaveBeenCalledWith("report", 10, "user", 5, { permissions: [] }));
    fireEvent.click(await screen.findByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(mocks.putSubject).toHaveBeenLastCalledWith("report", 10, "user", 5, { permissions: ["relatorio.ver", "relatorio.exportar"] }));
  });

  it("Personalizar abre os itens e marcar um grava a lista nova", async () => {
    await abrir([entry()]);

    fireEvent.change(screen.getByLabelText("Acesso de Ana Souza"), { target: { value: "__custom" } });
    fireEvent.click(screen.getByLabelText("Exportar por e-mail"));

    await waitFor(() => expect(mocks.putSubject).toHaveBeenCalledWith("report", 10, "user", 5, { permissions: ["relatorio.ver", "relatorio.exportar"] }));
  });

  it("o autocompletar acha pessoas e grupos e adicionar da o preset Ver", async () => {
    mocks.searchSubjects.mockResolvedValue([
      { kind: "group", id: 7, name: "Diretoria", email: null, picture_url: null },
      { kind: "user", id: 8, name: "Beto Lima", email: "beto@example.com", picture_url: null },
    ]);
    await abrir([]);

    fireEvent.change(screen.getByRole("combobox", { name: "Adicionar pessoas ou grupos" }), { target: { value: "be" } });
    fireEvent.click(await screen.findByRole("option", { name: /Beto Lima/ }));

    await waitFor(() => expect(mocks.putSubject).toHaveBeenCalledWith("report", 10, "user", 8, { preset: "ver" }));
    expect(await screen.findByText("Beto Lima agora tem acesso.")).toBeTruthy();
  });

  it("Enter escolhe a opcao destacada e as setas mudam o destaque", async () => {
    mocks.searchSubjects.mockResolvedValue([
      { kind: "user", id: 8, name: "Beto Lima", email: "beto@example.com", picture_url: null },
      { kind: "user", id: 9, name: "Bia Rocha", email: "bia@example.com", picture_url: null },
    ]);
    await abrir([]);
    const campo = screen.getByRole("combobox", { name: "Adicionar pessoas ou grupos" });

    fireEvent.change(campo, { target: { value: "b" } });
    await screen.findByRole("option", { name: /Bia Rocha/ });
    fireEvent.keyDown(campo, { key: "ArrowDown" });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() => expect(mocks.putSubject).toHaveBeenCalledWith("report", 10, "user", 9, { preset: "ver" }));
  });

  it("um e-mail sem cadastro vira a opcao Convidar e cria o convite", async () => {
    mocks.inviteByEmail.mockResolvedValue({ status: "pending" });
    await abrir([]);

    fireEvent.change(screen.getByRole("combobox", { name: "Adicionar pessoas ou grupos" }), { target: { value: "nova@example.com" } });
    fireEvent.click(await screen.findByRole("option", { name: /Convidar nova@example.com/ }));

    await waitFor(() => expect(mocks.inviteByEmail).toHaveBeenCalledWith("report", 10, "nova@example.com", "ver"));
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringMatching(/Convite criado/));
  });

  it("e-mail de quem ja existe nao oferece convite, so a pessoa", async () => {
    mocks.searchSubjects.mockResolvedValue([{ kind: "user", id: 8, name: "Beto Lima", email: "beto@example.com", picture_url: null }]);
    await abrir([]);

    fireEvent.change(screen.getByRole("combobox", { name: "Adicionar pessoas ou grupos" }), { target: { value: "beto@example.com" } });

    expect(await screen.findByRole("option", { name: /Beto Lima/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Convidar/ })).toBeNull();
  });

  it("erro ao gravar aparece como aviso e nao oferece desfazer", async () => {
    mocks.putSubject.mockRejectedValue({ response: { data: { detail: "Voce so pode dar o que tem" } } });
    await abrir([entry()]);

    fireEvent.change(screen.getByLabelText("Acesso de Ana Souza"), { target: { value: "exportar" } });

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Voce so pode dar o que tem", "error"));
    expect(screen.queryByRole("button", { name: "Desfazer" })).toBeNull();
  });

  it("erro ao carregar mostra a mensagem em vez de uma tela em branco", async () => {
    mocks.getPanel.mockRejectedValue({ response: { data: { detail: "Voce nao pode mudar os acessos deste relatorio" } } });
    render(<PermissionsPanel kind="report" itemId={10} itemName="Resultado" onClose={() => {}} />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/nao pode mudar os acessos/);
  });

  it("Esc e o fundo fecham o painel", async () => {
    mocks.getPanel.mockResolvedValue(panel([]));
    const onClose = vi.fn();
    render(<PermissionsPanel kind="report" itemId={10} itemName="Resultado" onClose={onClose} />);
    await screen.findByRole("combobox", { name: "Adicionar pessoas ou grupos" });

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(onClose).toHaveBeenCalled();
  });

  it("o painel de um modelo usa o mesmo contrato", async () => {
    mocks.getPanel.mockResolvedValue({ ...panel([]), item: { kind: "dataset", id: 3, name: "Modelo 1", subtitle: null } });
    render(<PermissionsPanel kind="dataset" itemId={3} itemName="Modelo 1" onClose={() => {}} />);

    await screen.findByRole("combobox", { name: "Adicionar pessoas ou grupos" });
    expect(mocks.getPanel).toHaveBeenCalledWith("dataset", 3);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toMatch(/do modelo Modelo 1/);
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as groupsApi from "../api/groups";
import type { Group } from "../api/groups";
import GroupAiPermissions from "./GroupAiPermissions";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../api/groups", () => ({
  AI_PERMISSION_MANAGE: "ia.gerenciar",
  AI_PERMISSION_USE: "ia.usar",
  ANALYTICS_PERMISSION_VIEW: "analiticos.ver",
  ANALYTICS_PERMISSION_CREATE: "analiticos.criar",
  ANALYTICS_PERMISSION_EDIT: "analiticos.editar",
  ANALYTICS_PERMISSION_DELETE: "analiticos.excluir",
  getGroupPermissions: vi.fn(),
  setGroupPermissions: vi.fn(),
}));

const get = vi.mocked(groupsApi.getGroupPermissions);
const set = vi.mocked(groupsApi.setGroupPermissions);

const GRUPO: Group = { id: 7, name: "Comercial", is_default: false, is_admin_group: false };
const ADMINS: Group = { id: 1, name: "Administradores", is_default: false, is_admin_group: true };

const gerenciar = () => screen.getByLabelText(/^Gerenciar IA/) as HTMLInputElement;
const usar = () => screen.getByLabelText(/^Usar o chat de IA/) as HTMLInputElement;

async function abrir(grupo: Group, permissions: string[], editable = true) {
  get.mockResolvedValue({ permissions, editable });
  render(<GroupAiPermissions group={grupo} />);
  await screen.findByText("Permissoes de IA");
}

beforeEach(() => {
  mocks.showToast.mockClear();
  get.mockReset();
  set.mockReset();
});

describe("GroupAiPermissions - analiticos", () => {
  it("tirar o ver tira tambem criar, editar e excluir", async () => {
    await abrir(GRUPO, ["analiticos.ver", "analiticos.criar", "analiticos.editar"]);
    set.mockResolvedValue({ permissions: [], editable: true });

    fireEvent.click(screen.getByLabelText(/^Ver analiticos/));

    await waitFor(() => expect(set).toHaveBeenCalledWith(7, []));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Permissoes de analiticos atualizadas."));
  });
});

describe("GroupAiPermissions - carregar", () => {
  it("pede as permissoes do grupo certo e marca so as que ele tem", async () => {
    await abrir(GRUPO, ["ia.usar"]);

    expect(get).toHaveBeenCalledWith(7);
    expect(usar().checked).toBe(true);
    expect(gerenciar().checked).toBe(false);
  });

  it("grupo sem nenhuma permissao comeca tudo desmarcado", async () => {
    await abrir(GRUPO, []);

    expect(usar().checked).toBe(false);
    expect(gerenciar().checked).toBe(false);
  });

  it("no grupo Administradores as duas aparecem marcadas e travadas, com o aviso", async () => {
    await abrir(ADMINS, ["ia.gerenciar", "ia.usar"], false);

    expect(usar().checked && gerenciar().checked).toBe(true);
    expect(usar().disabled && gerenciar().disabled).toBe(true);
    expect(screen.getByText("O grupo Administradores sempre tem todas as permissoes.")).toBeTruthy();
  });

  it("avisa quando nao consegue carregar", async () => {
    get.mockRejectedValue(new Error("403"));
    render(<GroupAiPermissions group={GRUPO} />);

    expect(await screen.findByText("Nao foi possivel carregar as permissoes.")).toBeTruthy();
  });
});

describe("GroupAiPermissions - salvar", () => {
  it("marcar uma caixa envia o conjunto novo, mantendo as que ja estavam, e avisa", async () => {
    set.mockResolvedValue({ permissions: ["ia.gerenciar", "ia.usar"], editable: true });
    await abrir(GRUPO, ["ia.usar"]);

    fireEvent.click(gerenciar());

    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set.mock.calls[0][0]).toBe(7);
    expect([...set.mock.calls[0][1]].sort()).toEqual(["ia.gerenciar", "ia.usar"]);
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Permissoes de IA atualizadas."));
    await waitFor(() => expect(gerenciar().checked).toBe(true));
  });

  it("desmarcar tira so aquela chave", async () => {
    set.mockResolvedValue({ permissions: ["ia.gerenciar"], editable: true });
    await abrir(GRUPO, ["ia.gerenciar", "ia.usar"]);

    fireEvent.click(usar());

    await waitFor(() => expect(set).toHaveBeenCalledWith(7, ["ia.gerenciar"]));
  });

  it("mostra o erro e mantem o estado anterior quando o servidor recusa", async () => {
    set.mockRejectedValue({ response: { data: { detail: "Voce precisa estar no grupo Administradores para essa acao" } } });
    await abrir(GRUPO, ["ia.usar"]);

    fireEvent.click(gerenciar());

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith("Voce precisa estar no grupo Administradores para essa acao", "error"),
    );
    expect(gerenciar().checked).toBe(false);
    expect(usar().checked).toBe(true);
  });
});

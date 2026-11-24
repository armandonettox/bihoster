import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tvsApi from "../../api/tvs";
import TvGrantsEditor from "./TvGrantsEditor";

vi.mock("../../api/tvs", () => ({ getTvGrants: vi.fn(), listTvPeople: vi.fn(), replaceTvGrants: vi.fn() }));
const showToast = vi.fn();
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast }) }));

const getTvGrants = vi.mocked(tvsApi.getTvGrants);
const listTvPeople = vi.mocked(tvsApi.listTvPeople);
const replaceTvGrants = vi.mocked(tvsApi.replaceTvGrants);

const PESSOAS = {
  users: [
    { id: 1, name: "Ana", email: "ana@exemplo.com" },
    { id: 2, name: "Bruno", email: "bruno@exemplo.com" },
  ],
  groups: [{ id: 9, name: "Recepcionistas", email: null }],
};

beforeEach(() => {
  vi.resetAllMocks();
  getTvGrants.mockResolvedValue([{ user_id: 1, group_id: null, name: "Ana", level: "modificar" }]);
  listTvPeople.mockResolvedValue(PESSOAS);
  replaceTvGrants.mockImplementation(async (_id, grants) =>
    grants.map((g) => ({ user_id: g.user_id ?? null, group_id: g.group_id ?? null, name: g.group_id ? "Recepcionistas" : g.user_id === 1 ? "Ana" : "Bruno", level: g.level })),
  );
});

describe("TvGrantsEditor", () => {
  it("mostra quem ja acessa e so oferece quem ainda nao esta na lista", async () => {
    render(<TvGrantsEditor tvId={4} />);

    expect(await screen.findByText("Ana")).toBeTruthy();
    expect((screen.getByLabelText("Permissão de Ana") as HTMLSelectElement).value).toBe("modificar");
    const opcoes = Array.from((screen.getByLabelText("Pessoa ou grupo") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(opcoes).toEqual(["Escolha uma pessoa ou grupo", "Recepcionistas", "Bruno (bruno@exemplo.com)"]);
  });

  it("sem ninguem, explica que so o administrador acessa", async () => {
    getTvGrants.mockResolvedValue([]);
    render(<TvGrantsEditor tvId={4} />);

    expect(await screen.findByText(/Só o administrador da plataforma acessa esta TV/)).toBeTruthy();
  });

  it("adiciona um grupo e uma pessoa com o nivel escolhido e salva tudo de uma vez", async () => {
    render(<TvGrantsEditor tvId={4} />);
    await screen.findByText("Ana");
    const salvar = screen.getByRole("button", { name: "Salvar permissões" }) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Pessoa ou grupo"), { target: { value: "g9" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    fireEvent.change(screen.getByLabelText("Pessoa ou grupo"), { target: { value: "u2" } });
    fireEvent.change(screen.getByLabelText("Nível da nova permissão"), { target: { value: "modificar" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(salvar.disabled).toBe(false);
    fireEvent.click(salvar);

    await waitFor(() => expect(replaceTvGrants).toHaveBeenCalledTimes(1));
    expect(replaceTvGrants).toHaveBeenCalledWith(4, [
      { user_id: 1, group_id: null, level: "modificar" },
      { user_id: null, group_id: 9, level: "ver" },
      { user_id: 2, group_id: null, level: "modificar" },
    ]);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Permissões da TV salvas."));
    expect((screen.getByRole("button", { name: "Salvar permissões" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("troca o nivel de quem ja esta e tira alguem da lista", async () => {
    render(<TvGrantsEditor tvId={4} />);
    await screen.findByText("Ana");

    fireEvent.change(screen.getByLabelText("Permissão de Ana"), { target: { value: "ver" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar permissões" }));
    await waitFor(() => expect(replaceTvGrants).toHaveBeenCalledWith(4, [{ user_id: 1, group_id: null, level: "ver" }]));

    fireEvent.click(screen.getByLabelText("Tirar Ana"));
    expect(screen.getByText(/Só o administrador da plataforma acessa esta TV/)).toBeTruthy();
  });

  it("erro ao salvar avisa e mantem a lista", async () => {
    replaceTvGrants.mockRejectedValue({ response: { data: { detail: "Pessoa nao encontrada" } } });
    render(<TvGrantsEditor tvId={4} />);
    await screen.findByText("Ana");
    fireEvent.change(screen.getByLabelText("Permissão de Ana"), { target: { value: "ver" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar permissões" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Pessoa nao encontrada", "error"));
    expect((screen.getByLabelText("Permissão de Ana") as HTMLSelectElement).value).toBe("ver");
  });

  it("sem permissao para ver a lista, mostra o motivo", async () => {
    getTvGrants.mockRejectedValue({ response: { data: { detail: "Voce nao tem permissao para modificar esta TV" } } });
    render(<TvGrantsEditor tvId={4} />);

    expect(await screen.findByText("Voce nao tem permissao para modificar esta TV")).toBeTruthy();
  });
});

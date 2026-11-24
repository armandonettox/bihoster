import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tvsApi from "../api/tvs";
import type { MyAccess } from "../api/access";
import { AccessContext, buildAccess } from "../context/AccessContext";
import Tvs from "./Tvs";

vi.mock("../api/tvs", async () => ({
  ...(await vi.importActual<typeof import("../api/tvs")>("../api/tvs")),
  listTvs: vi.fn(),
  createTv: vi.fn(),
  deleteTv: vi.fn(),
  getTv: vi.fn(),
}));
const showToast = vi.fn();
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../utils/clipboard", () => ({ copyText: vi.fn().mockResolvedValue(undefined) }));

const listTvs = vi.mocked(tvsApi.listTvs);
const createTv = vi.mocked(tvsApi.createTv);
const deleteTv = vi.mocked(tvsApi.deleteTv);
const getTv = vi.mocked(tvsApi.getTv);

const TV = (patch: Partial<tvsApi.TvSummary> = {}): tvsApi.TvSummary => ({
  id: 1,
  name: "Recepcao",
  level: "modificar",
  items_count: 3,
  total_seconds: 150,
  session_hours: null,
  online: false,
  last_seen_at: null,
  ...patch,
});

function abrir(acesso: Partial<MyAccess> = { global_permissions: ["tv.criar"], tv_access: true }) {
  const me: MyAccess = { is_admin: false, global_permissions: [], workspace_permissions: {}, ...acesso };
  return render(
    <MemoryRouter initialEntries={["/tv"]}>
      <AccessContext.Provider value={buildAccess(me)}>
        <Routes>
          <Route path="/tv" element={<Tvs />} />
          <Route path="/tv/:id" element={<div data-testid="editor" />} />
          <Route path="/" element={<div data-testid="inicio" />} />
        </Routes>
      </AccessContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  listTvs.mockResolvedValue([TV(), TV({ id: 2, name: "Sala de reuniao", level: "ver", items_count: 1, total_seconds: 30, online: true })]);
});

describe("Tvs - a lista", () => {
  it("mostra cada TV com os itens, a volta completa e se esta ligada", async () => {
    abrir();

    expect(await screen.findByText("Recepcao")).toBeTruthy();
    expect(screen.getByText("3 itens, volta completa em 2 min 30 s")).toBeTruthy();
    expect(screen.getByText("1 item, volta completa em 30 s")).toBeTruthy();
    expect(screen.getByText("Ligada agora")).toBeTruthy();
    expect(screen.getByText("Desligada ou sem conexão")).toBeTruthy();
  });

  it("quem nao tem nenhum acesso ao modulo volta para o inicio", async () => {
    abrir({ global_permissions: [], tv_access: false });

    expect(await screen.findByTestId("inicio")).toBeTruthy();
  });

  it("quem so tem acesso a uma TV nao ve o campo de criar", async () => {
    abrir({ global_permissions: [], tv_access: true });
    await screen.findByText("Recepcao");

    expect(screen.queryByLabelText("Nome da nova TV")).toBeNull();
  });

  it("sem nenhuma TV, avisa conforme possa criar ou nao", async () => {
    listTvs.mockResolvedValue([]);
    const { unmount } = abrir();
    expect(await screen.findByText(/Nenhuma TV ainda. Crie a primeira acima./)).toBeTruthy();
    unmount();

    abrir({ global_permissions: [], tv_access: true });
    expect(await screen.findByText("Você ainda não tem acesso a nenhuma TV.")).toBeTruthy();
  });

  it("erro ao carregar mostra o motivo", async () => {
    listTvs.mockRejectedValue({ response: { data: { detail: "Falha no servidor" } } });
    abrir();

    expect(await screen.findByText("Falha no servidor")).toBeTruthy();
  });
});

describe("Tvs - criar", () => {
  it("cria com o nome escrito e abre o cadastro da TV nova", async () => {
    createTv.mockResolvedValue({ ...TV({ id: 9, name: "Nova" }), link_secret: "x", items: [] });
    abrir();
    await screen.findByText("Recepcao");

    fireEvent.change(screen.getByLabelText("Nome da nova TV"), { target: { value: "  Nova  " } });
    fireEvent.click(screen.getByRole("button", { name: "Criar TV" }));

    expect(await screen.findByTestId("editor")).toBeTruthy();
    expect(createTv).toHaveBeenCalledWith("Nova");
  });

  it("nome vazio nao deixa criar", async () => {
    abrir();
    await screen.findByText("Recepcao");

    expect((screen.getByRole("button", { name: "Criar TV" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("erro ao criar mostra o motivo e fica na lista", async () => {
    createTv.mockRejectedValue({ response: { data: { detail: "Voce nao tem permissao para essa acao" } } });
    abrir();
    await screen.findByText("Recepcao");

    fireEvent.change(screen.getByLabelText("Nome da nova TV"), { target: { value: "Nova" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar TV" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Voce nao tem permissao para essa acao", "error"));
    expect(screen.queryByTestId("editor")).toBeNull();
  });
});

describe("Tvs - o menu de cada TV", () => {
  const menuDe = (nome: string) => {
    const card = screen.getByText(nome).closest("li") as HTMLElement;
    fireEvent.click(card.querySelector("button[aria-label='Mais opcoes']") as HTMLElement);
  };

  it("quem pode modificar ve Editar e Excluir; quem so ve, Ver detalhes e sem Excluir", async () => {
    abrir();
    await screen.findByText("Recepcao");

    menuDe("Recepcao");
    expect(screen.getByRole("button", { name: /Editar/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Excluir/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    menuDe("Sala de reuniao");
    expect(screen.getByRole("button", { name: /Ver detalhes/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Excluir/ })).toBeNull();
  });

  it("copia o link secreto da TV", async () => {
    getTv.mockResolvedValue({ ...TV(), link_secret: "segredo-abc", items: [] });
    const { copyText } = await import("../utils/clipboard");
    abrir();
    await screen.findByText("Recepcao");

    menuDe("Recepcao");
    fireEvent.click(screen.getByRole("button", { name: /Copiar o link/ }));

    await waitFor(() => expect(copyText).toHaveBeenCalledWith(`${window.location.origin}/tv/p/segredo-abc`));
    expect(showToast).toHaveBeenCalledWith("Link da TV copiado.");
  });

  it("abre a TV em outra aba pelo link secreto", async () => {
    getTv.mockResolvedValue({ ...TV(), link_secret: "segredo-abc", items: [] });
    const abrirJanela = vi.spyOn(window, "open").mockImplementation(() => null);
    abrir();
    await screen.findByText("Recepcao");

    menuDe("Recepcao");
    fireEvent.click(screen.getByRole("button", { name: /Abrir a TV/ }));

    await waitFor(() => expect(abrirJanela).toHaveBeenCalledWith(`${window.location.origin}/tv/p/segredo-abc`, "_blank", "noopener"));
    abrirJanela.mockRestore();
  });

  it("excluir pede confirmacao e so apaga depois dela", async () => {
    deleteTv.mockResolvedValue(undefined);
    abrir();
    await screen.findByText("Recepcao");

    menuDe("Recepcao");
    fireEvent.click(screen.getByRole("button", { name: /Excluir/ }));
    expect(deleteTv).not.toHaveBeenCalled();
    expect(screen.getByText(/Isso não pode ser desfeito/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Excluir" }).at(-1) as HTMLElement);

    await waitFor(() => expect(deleteTv).toHaveBeenCalledWith(1));
    expect(showToast).toHaveBeenCalledWith("TV excluída.");
  });
});

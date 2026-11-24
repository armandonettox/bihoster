import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tvsApi from "../api/tvs";
import TvEditor from "./TvEditor";

vi.mock("../api/tvs", async () => ({
  ...(await vi.importActual<typeof import("../api/tvs")>("../api/tvs")),
  getTv: vi.fn(),
  updateTv: vi.fn(),
  deleteTv: vi.fn(),
  disconnectTv: vi.fn(),
  regenerateTvLink: vi.fn(),
  replaceTvItems: vi.fn(),
}));
vi.mock("../components/tv/TvCodePanel", () => ({ default: () => <div data-testid="codigo">123 456</div> }));
vi.mock("../components/tv/TvGrantsEditor", () => ({ default: () => <div data-testid="permissoes" /> }));
vi.mock("../components/tv/TvItemsEditor", async () => {
  const real = await vi.importActual<typeof import("../components/tv/TvItemsEditor")>("../components/tv/TvItemsEditor");
  return {
    ...real,
    default: ({ items, onChange, readOnly }: { items: { key: string; title: string }[]; onChange: (n: never[]) => void; readOnly: boolean }) => (
      <div data-testid="itens" data-readonly={String(readOnly)}>
        {items.map((i) => i.title).join(",")}
        <button onClick={() => onChange(items.slice(1) as never[])}>tirar primeiro</button>
      </div>
    ),
  };
});
const showToast = vi.fn();
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../utils/clipboard", () => ({ copyText: vi.fn().mockResolvedValue(undefined) }));

const getTv = vi.mocked(tvsApi.getTv);
const updateTv = vi.mocked(tvsApi.updateTv);
const deleteTv = vi.mocked(tvsApi.deleteTv);
const disconnectTv = vi.mocked(tvsApi.disconnectTv);
const regenerateTvLink = vi.mocked(tvsApi.regenerateTvLink);
const replaceTvItems = vi.mocked(tvsApi.replaceTvItems);

const ITEM: tvsApi.TvItem = { id: 1, kind: "youtube", seconds: 60, report_id: null, report_name: null, collection_name: null, page_name: null, image_url: null, video_id: "dQw4w9WgXcQ", sound: false };
const TV = (patch: Partial<tvsApi.TvDetail> = {}): tvsApi.TvDetail => ({
  id: 4,
  name: "Recepcao",
  level: "modificar",
  items_count: 2,
  total_seconds: 120,
  session_hours: null,
  online: false,
  last_seen_at: null,
  link_secret: "segredo-abc",
  items: [ITEM, { ...ITEM, id: 2, video_id: "aaaaaaaaaaa" }],
  ...patch,
});

function abrir(id = "4") {
  return render(
    <MemoryRouter initialEntries={[`/tv/${id}`]}>
      <Routes>
        <Route path="/tv/:tvId" element={<TvEditor />} />
        <Route path="/tv" element={<div data-testid="lista" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  getTv.mockResolvedValue(TV());
});

describe("TvEditor - quem pode modificar", () => {
  it("mostra o nome, o link secreto, o codigo, a programacao, as permissoes e o excluir", async () => {
    abrir();

    expect(((await screen.findByLabelText("Nome da TV")) as HTMLInputElement).value).toBe("Recepcao");
    expect((screen.getByLabelText("Link da TV") as HTMLInputElement).value).toBe(`${window.location.origin}/tv/p/segredo-abc`);
    expect(screen.getByTestId("codigo")).toBeTruthy();
    expect(screen.getByTestId("itens").getAttribute("data-readonly")).toBe("false");
    expect(screen.getByTestId("permissoes")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Excluir a TV/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Trocar o link/ })).toBeTruthy();
  });

  it("o link abre em outra aba, de forma segura", async () => {
    abrir();

    const link = (await screen.findByRole("link", { name: /Abrir em outra aba/ })) as HTMLAnchorElement;

    expect(link.getAttribute("href")).toBe(`${window.location.origin}/tv/p/segredo-abc`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("copia o link", async () => {
    const { copyText } = await import("../utils/clipboard");
    abrir();
    await screen.findByLabelText("Nome da TV");

    fireEvent.click(screen.getByRole("button", { name: /Copiar/ }));

    await waitFor(() => expect(copyText).toHaveBeenCalledWith(`${window.location.origin}/tv/p/segredo-abc`));
    expect(showToast).toHaveBeenCalledWith("Link da TV copiado.");
  });

  it("salva o nome ao sair do campo, e nome vazio volta ao anterior sem chamar o servidor", async () => {
    updateTv.mockResolvedValue(TV({ name: "Sala nova" }));
    abrir();
    const campo = (await screen.findByLabelText("Nome da TV")) as HTMLInputElement;

    fireEvent.change(campo, { target: { value: "   " } });
    fireEvent.blur(campo);
    expect(campo.value).toBe("Recepcao");
    expect(updateTv).not.toHaveBeenCalled();

    fireEvent.change(campo, { target: { value: "Sala nova" } });
    fireEvent.blur(campo);

    await waitFor(() => expect(updateTv).toHaveBeenCalledWith(4, { name: "Sala nova" }));
    expect(showToast).toHaveBeenCalledWith("Nome da TV salvo.");
  });

  it("o tempo de conexao vem com 'Para sempre' marcado e muda para o escolhido", async () => {
    updateTv.mockResolvedValue(TV({ session_hours: 24 }));
    abrir();
    const campo = (await screen.findByLabelText(/Tempo de conexão/)) as HTMLSelectElement;
    expect(campo.value).toBe("forever");
    expect(within(campo).getAllByRole("option").map((o) => o.textContent)).toContain("Para sempre");

    fireEvent.change(campo, { target: { value: "24" } });

    await waitFor(() => expect(updateTv).toHaveBeenCalledWith(4, { session_hours: 24 }));
    expect(campo.value).toBe("24");
  });

  it("voltar para 'Para sempre' manda vazio", async () => {
    getTv.mockResolvedValue(TV({ session_hours: 8 }));
    updateTv.mockResolvedValue(TV({ session_hours: null }));
    abrir();
    const campo = (await screen.findByLabelText(/Tempo de conexão/)) as HTMLSelectElement;
    expect(campo.value).toBe("8");

    fireEvent.change(campo, { target: { value: "forever" } });

    await waitFor(() => expect(updateTv).toHaveBeenCalledWith(4, { session_hours: null }));
  });

  it("desconectar pede confirmacao e so desconecta depois dela", async () => {
    disconnectTv.mockResolvedValue(undefined);
    abrir();
    await screen.findByLabelText("Nome da TV");

    fireEvent.click(screen.getByRole("button", { name: /Desconectar a TV/ }));
    expect(disconnectTv).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Desconectar" }));

    await waitFor(() => expect(disconnectTv).toHaveBeenCalledWith(4));
    expect(showToast).toHaveBeenCalledWith("TV desconectada. Para voltar, ela precisa do código.");
  });

  it("trocar o link pede confirmacao e passa a mostrar o link novo", async () => {
    regenerateTvLink.mockResolvedValue(TV({ link_secret: "segredo-novo" }));
    abrir();
    await screen.findByLabelText("Nome da TV");

    fireEvent.click(screen.getByRole("button", { name: /Trocar o link/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Trocar o link" }));

    await waitFor(() => expect((screen.getByLabelText("Link da TV") as HTMLInputElement).value).toContain("segredo-novo"));
  });

  it("excluir pede confirmacao, apaga e volta para a lista", async () => {
    deleteTv.mockResolvedValue(undefined);
    abrir();
    await screen.findByLabelText("Nome da TV");

    fireEvent.click(screen.getByRole("button", { name: /Excluir a TV/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Excluir" }));

    expect(await screen.findByTestId("lista")).toBeTruthy();
    expect(deleteTv).toHaveBeenCalledWith(4);
  });

  it("a programacao so salva quando mudou, e depois de salvar o botao desliga de novo", async () => {
    replaceTvItems.mockResolvedValue(TV({ items: [{ ...ITEM, id: 2, video_id: "aaaaaaaaaaa" }] }));
    abrir();
    await screen.findByLabelText("Nome da TV");
    const salvar = screen.getByRole("button", { name: "Salvar programação" }) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true);

    fireEvent.click(screen.getByText("tirar primeiro"));
    expect(salvar.disabled).toBe(false);
    expect(screen.getByText("Há mudanças ainda não salvas.")).toBeTruthy();
    fireEvent.click(salvar);

    await waitFor(() => expect(replaceTvItems).toHaveBeenCalledTimes(1));
    expect(replaceTvItems.mock.calls[0][1]).toHaveLength(1);
    await waitFor(() => expect((screen.getByRole("button", { name: "Salvar programação" }) as HTMLButtonElement).disabled).toBe(true));
  });

  it("erro ao salvar a programacao mostra o motivo e mantem as mudancas", async () => {
    replaceTvItems.mockRejectedValue({ response: { data: { detail: "O relatorio Vendas tem seguranca por linha (RLS) e nao pode passar na TV." } } });
    abrir();
    await screen.findByLabelText("Nome da TV");
    fireEvent.click(screen.getByText("tirar primeiro"));

    fireEvent.click(screen.getByRole("button", { name: "Salvar programação" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("O relatorio Vendas tem seguranca por linha (RLS) e nao pode passar na TV.", "error"));
    expect((screen.getByRole("button", { name: "Salvar programação" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("TvEditor - quem so pode ver", () => {
  beforeEach(() => {
    getTv.mockResolvedValue(TV({ level: "ver" }));
  });

  it("ve tudo em leitura, abre o link, ve o codigo e desconecta, mas nao edita nem troca o link nem exclui", async () => {
    abrir();

    expect(await screen.findByRole("heading", { name: "Recepcao" })).toBeTruthy();
    expect(screen.queryByLabelText("Nome da TV")).toBeNull();
    expect(screen.getByTestId("itens").getAttribute("data-readonly")).toBe("true");
    expect(screen.getByTestId("codigo")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Abrir em outra aba/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Desconectar a TV/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Trocar o link/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Excluir a TV/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Salvar programação" })).toBeNull();
    expect(screen.queryByTestId("permissoes")).toBeNull();
    expect((screen.getByLabelText(/Tempo de conexão/) as HTMLSelectElement).disabled).toBe(true);
  });
});

describe("TvEditor - erros", () => {
  it("TV que nao existe ou sem acesso mostra o aviso e o caminho de volta", async () => {
    getTv.mockRejectedValue({ response: { data: { detail: "TV nao encontrada" } } });
    abrir();

    expect(await screen.findByText("TV nao encontrada")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voltar ao Modo TV" })).toBeTruthy();
  });

  it("endereco com id que nao e numero nem chega a consultar", async () => {
    abrir("abc");

    expect(await screen.findByText(/TV nao encontrada ou voce nao tem acesso/)).toBeTruthy();
    expect(getTv).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tvsApi from "../../api/tvs";
import TvItemsEditor, { draftsFromItems, inputsFromDrafts, youtubeIdFromLink, type DraftItem } from "./TvItemsEditor";

vi.mock("../../api/tvs", () => ({
  listTvReports: vi.fn(),
  listTvReportPages: vi.fn(),
  uploadTvImage: vi.fn(),
  getReportRls: vi.fn(),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const listTvReports = vi.mocked(tvsApi.listTvReports);
const listTvReportPages = vi.mocked(tvsApi.listTvReportPages);
const uploadTvImage = vi.mocked(tvsApi.uploadTvImage);
const getReportRls = vi.mocked(tvsApi.getReportRls);

const ITENS: tvsApi.TvItem[] = [
  { id: 1, kind: "report_page", seconds: 30, report_id: 7, report_name: "Vendas", collection_name: "Comercial", page_name: "P1", image_url: null, video_id: null, sound: false },
  { id: 2, kind: "youtube", seconds: 60, report_id: null, report_name: null, collection_name: null, page_name: null, image_url: null, video_id: "dQw4w9WgXcQ", sound: false },
];

/** O editor com estado de verdade, como a pagina usa: guarda a lista e devolve o que a pessoa ve */
function Editor({ inicial = ITENS, readOnly = false, onChange }: { inicial?: tvsApi.TvItem[]; readOnly?: boolean; onChange?: (d: DraftItem[]) => void }) {
  const [drafts, setDrafts] = useState(() => draftsFromItems(inicial));
  return (
    <TvItemsEditor
      tvId={5}
      items={drafts}
      readOnly={readOnly}
      onChange={(next) => {
        setDrafts(next);
        onChange?.(next);
      }}
    />
  );
}

const ordem = () => screen.getAllByRole("listitem").map((li) => li.querySelector("strong")?.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  getReportRls.mockResolvedValue({ rls: false, switch_on: false, roles: [] });
  listTvReports.mockResolvedValue([
    { id: 7, name: "Vendas", collection_id: 1, collection_name: "Comercial" },
    { id: 8, name: "Estoque", collection_id: 2, collection_name: "Logistica" },
  ]);
  listTvReportPages.mockResolvedValue([
    { name: "P1", title: "Resumo" },
    { name: "P2", title: "Detalhe" },
  ]);
});

describe("youtubeIdFromLink", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=3", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x", "dQw4w9WgXcQ"],
    ["https://evil.com/watch?v=dQw4w9WgXcQ", null],
    ["javascript:alert(1)", null],
    ["https://youtu.be/curto", null],
    ["texto solto", null],
    ["", null],
  ])("%s", (link, esperado) => {
    expect(youtubeIdFromLink(link)).toBe(esperado);
  });
});

describe("TvItemsEditor - a lista", () => {
  it("mostra cada item com o nome, o detalhe e o tempo, e o total da volta completa", () => {
    render(<Editor />);

    expect(ordem()).toEqual(["Vendas", "Vídeo do YouTube"]);
    expect(screen.getByText("Comercial · página P1")).toBeTruthy();
    expect((screen.getByLabelText("Segundos do item 1") as HTMLInputElement).value).toBe("30");
    expect(screen.getByText("2 itens, 1 min 30 s para dar a volta completa.")).toBeTruthy();
  });

  it("lista vazia explica o que fazer", () => {
    render(<Editor inicial={[]} />);

    expect(screen.getByText(/Nenhum item ainda/)).toBeTruthy();
  });

  it("sobe e desce itens, e os botoes das pontas ficam desligados", () => {
    render(<Editor />);
    expect((screen.getByLabelText("Subir o item 1") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Descer o item 2") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("Descer o item 1"));

    expect(ordem()).toEqual(["Vídeo do YouTube", "Vendas"]);
  });

  it("remove um item", () => {
    render(<Editor />);

    fireEvent.click(screen.getByLabelText("Remover o item 1"));

    expect(ordem()).toEqual(["Vídeo do YouTube"]);
  });

  it("o tempo de cada item muda e fica entre 3 segundos e 1 hora", () => {
    render(<Editor />);
    const campo = screen.getByLabelText("Segundos do item 1") as HTMLInputElement;

    fireEvent.change(campo, { target: { value: "45" } });
    expect(campo.value).toBe("45");
    fireEvent.change(campo, { target: { value: "1" } });
    fireEvent.blur(campo);
    expect(campo.value).toBe("3");
    fireEvent.change(campo, { target: { value: "99999" } });
    fireEvent.blur(campo);
    expect(campo.value).toBe("3600");
  });

  it("o som do video se liga e desliga no proprio item", () => {
    render(<Editor />);
    const som = screen.getByRole("checkbox", { name: "Tocar com som" }) as HTMLInputElement;
    expect(som.checked).toBe(false);

    fireEvent.click(som);

    expect(som.checked).toBe(true);
  });

  it("so ver: nada de botoes, campos desligados e sem adicionar", () => {
    render(<Editor readOnly />);

    expect(screen.queryByLabelText("Subir o item 1")).toBeNull();
    expect(screen.queryByLabelText("Remover o item 1")).toBeNull();
    expect(screen.queryByRole("button", { name: /Página de relatório/ })).toBeNull();
    expect((screen.getByLabelText("Segundos do item 1") as HTMLInputElement).disabled).toBe(true);
  });

  it("monta o que vai ser salvo: o link do youtube volta a ser um link e o resto segue igual", () => {
    const entrada = inputsFromDrafts(draftsFromItems(ITENS));

    expect(entrada).toEqual([
      { kind: "report_page", seconds: 30, report_id: 7, page_name: "P1", image_url: null, video_url: null, sound: false, rls_role: null },
      { kind: "youtube", seconds: 60, report_id: null, page_name: null, image_url: null, video_url: "https://youtu.be/dQw4w9WgXcQ", sound: false, rls_role: null },
    ]);
  });
});

describe("TvItemsEditor - adicionar", () => {
  it("pagina de relatorio: escolhe o relatorio (agrupado por colecao), a pagina e o tempo", async () => {
    render(<Editor inicial={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /Página de relatório/ }));
    const relatorio = await screen.findByLabelText("Relatório");
    await waitFor(() => expect(within(relatorio).getAllByRole("option").length).toBeGreaterThan(1));
    expect(within(relatorio).getAllByRole("group").map((g) => g.getAttribute("label"))).toEqual(["Comercial", "Logistica"]);

    fireEvent.change(relatorio, { target: { value: "8" } });
    const pagina = await screen.findByLabelText("Página");
    await waitFor(() => expect(within(pagina).getAllByRole("option").length).toBe(3));
    expect((screen.getByRole("button", { name: "Adicionar à lista" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(pagina, { target: { value: "P2" } });
    fireEvent.change(screen.getByLabelText("Tempo na tela (segundos)"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar à lista" }));

    expect(ordem()).toEqual(["Estoque"]);
    expect(screen.getByText("Logistica · Detalhe")).toBeTruthy();
    expect((screen.getByLabelText("Segundos do item 1") as HTMLInputElement).value).toBe("45");
  });

  it("relatorio de uma pagina so ja vem com a pagina escolhida", async () => {
    listTvReportPages.mockResolvedValue([{ name: "P1", title: "Resumo" }]);
    render(<Editor inicial={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /Página de relatório/ }));
    fireEvent.change(await screen.findByLabelText("Relatório"), { target: { value: "7" } });

    await waitFor(() => expect((screen.getByLabelText("Página") as HTMLSelectElement).value).toBe("P1"));
    expect((screen.getByRole("button", { name: "Adicionar à lista" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("video do YouTube: valida o link, escolhe o som e o tempo", () => {
    render(<Editor inicial={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /Vídeo do YouTube/ }));
    fireEvent.change(screen.getByLabelText("Link do vídeo"), { target: { value: "https://exemplo.com/x" } });
    expect(screen.getByText(/não parece ser de um vídeo do YouTube/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Adicionar à lista" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Link do vídeo"), { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Tocar com som" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar à lista" }));

    expect(ordem()).toEqual(["Vídeo do YouTube"]);
    expect((screen.getByRole("checkbox", { name: "Tocar com som" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Segundos do item 1") as HTMLInputElement).value).toBe("60");
  });

  it("imagem: envia o arquivo e entra na lista com o tempo escolhido", async () => {
    uploadTvImage.mockResolvedValue("/static/uploads/tv/abc.png");
    const mudou = vi.fn();
    render(<Editor inicial={[]} onChange={mudou} />);

    fireEvent.click(screen.getByRole("button", { name: /^.*Imagem$/ }));
    fireEvent.change(screen.getByLabelText("Tempo na tela (segundos)"), { target: { value: "20" } });
    const arquivo = new File(["x"], "capa.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/Imagem \(PNG, JPG, GIF ou WebP/), { target: { files: [arquivo] } });

    await waitFor(() => expect(ordem()).toEqual(["capa.png"]));
    expect(uploadTvImage).toHaveBeenCalledWith(5, arquivo);
    expect(mudou.mock.calls.at(-1)![0][0]).toMatchObject({ kind: "image", seconds: 20, image_url: "/static/uploads/tv/abc.png" });
  });

  it("imagem recusada pelo servidor mostra o motivo e nao entra na lista", async () => {
    uploadTvImage.mockRejectedValue({ response: { data: { detail: "Formato de imagem nao suportado" } } });
    render(<Editor inicial={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /^.*Imagem$/ }));
    fireEvent.change(screen.getByLabelText(/Imagem \(PNG, JPG, GIF ou WebP/), { target: { files: [new File(["x"], "a.png")] } });

    expect(await screen.findByText("Formato de imagem nao suportado")).toBeTruthy();
    expect(screen.getByText(/Nenhum item ainda/)).toBeTruthy();
  });
});

describe("TvItemsEditor - relatorio com RLS", () => {
  async function escolherRelatorio() {
    render(<Editor inicial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Página de relatório/ }));
    fireEvent.change(await screen.findByLabelText("Relatório"), { target: { value: "8" } });
    const pagina = await screen.findByLabelText("Página");
    await waitFor(() => expect(within(pagina).getAllByRole("option").length).toBe(3));
    fireEvent.change(pagina, { target: { value: "P2" } });
  }

  it("com RLS, so deixa adicionar depois de escolher uma das funcoes que a pessoa tem, e grava a funcao", async () => {
    getReportRls.mockResolvedValue({ rls: true, switch_on: true, roles: ["Gerente", "Vendedor"] });
    await escolherRelatorio();
    const botao = screen.getByRole("button", { name: "Adicionar à lista" }) as HTMLButtonElement;
    await screen.findByLabelText(/Função de segurança da TV/);
    expect(botao.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Função de segurança da TV/), { target: { value: "Vendedor" } });
    expect(botao.disabled).toBe(false);
    fireEvent.click(botao);

    expect(ordem()).toEqual(["Estoque"]);
    expect(screen.getByText("Logistica · Detalhe · função Vendedor")).toBeTruthy();
  });

  it("uma so funcao ja vem escolhida", async () => {
    getReportRls.mockResolvedValue({ rls: true, switch_on: true, roles: ["Gerente"] });
    await escolherRelatorio();

    await waitFor(() => expect((screen.getByLabelText(/Função de segurança da TV/) as HTMLSelectElement).value).toBe("Gerente"));
  });

  it("chave geral desligada: avisa e nao deixa adicionar", async () => {
    getReportRls.mockResolvedValue({ rls: true, switch_on: false, roles: [] });
    await escolherRelatorio();

    expect((await screen.findByRole("alert")).textContent).toMatch(/permitir a saída de relatório com RLS/);
    expect((screen.getByRole("button", { name: "Adicionar à lista" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sem funcao nenhuma na pessoa: avisa e nao deixa adicionar", async () => {
    getReportRls.mockResolvedValue({ rls: true, switch_on: true, roles: [] });
    await escolherRelatorio();

    expect((await screen.findByRole("alert")).textContent).toMatch(/você não tem função de segurança nele/);
    expect((screen.getByRole("button", { name: "Adicionar à lista" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("relatorio sem RLS segue como sempre, sem funcao", async () => {
    getReportRls.mockResolvedValue({ rls: false, switch_on: false, roles: [] });
    await escolherRelatorio();

    await waitFor(() => expect((screen.getByRole("button", { name: "Adicionar à lista" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByLabelText(/Função de segurança da TV/)).toBeNull();
  });

  it("o item salvo leva a funcao e a lista mostra qual e", () => {
    const itens: tvsApi.TvItem[] = [{ ...ITENS[0], rls_role: "Gerente" }];

    expect(inputsFromDrafts(draftsFromItems(itens))[0].rls_role).toBe("Gerente");
  });
});


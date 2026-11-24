import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as playerApi from "../api/tvPlayer";
import type { PlayerItem } from "../api/tvPlayer";
import TvPlayer from "./TvPlayer";

vi.mock("../api/tvPlayer", () => ({
  linkExists: vi.fn(),
  connectTv: vi.fn(),
  fetchPlaylist: vi.fn(),
  fetchItemEmbed: vi.fn(),
  savedTvToken: vi.fn(),
  forgetTvToken: vi.fn(),
}));
vi.mock("../components/ReportEmbed", () => ({
  default: ({ forcePage, reportId }: { forcePage?: string; reportId: number }) => (
    <div data-testid="embed">{`embed ${reportId} pagina ${forcePage}`}</div>
  ),
}));

const linkExists = vi.mocked(playerApi.linkExists);
const connectTv = vi.mocked(playerApi.connectTv);
const fetchPlaylist = vi.mocked(playerApi.fetchPlaylist);
const savedTvToken = vi.mocked(playerApi.savedTvToken);
const forgetTvToken = vi.mocked(playerApi.forgetTvToken);

const RELATORIO: PlayerItem = {
  id: 10,
  kind: "report_page",
  seconds: 20,
  report_name: "Vendas",
  page_name: "ReportSection2",
  image_url: null,
  video_id: null,
  sound: false,
};
const IMAGEM: PlayerItem = { id: 11, kind: "image", seconds: 5, report_name: null, page_name: null, image_url: "/static/uploads/tv/a.png", video_id: null, sound: false };
const VIDEO: PlayerItem = { id: 12, kind: "youtube", seconds: 40, report_name: null, page_name: null, image_url: null, video_id: "dQw4w9WgXcQ", sound: true };

function abrir() {
  return render(
    <MemoryRouter initialEntries={["/tv/p/segredo123"]}>
      <Routes>
        <Route path="/tv/p/:secret" element={<TvPlayer />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A imagem da programacao (tem alt vazio, entao nao aparece como "img" para o leitor de tela) */
const imagem = () => document.querySelector("img.tv-player-image") as HTMLImageElement;
const digitar = (valor: string) => fireEvent.change(screen.getByLabelText("Código de acesso"), { target: { value: valor } });
const enviar = () => fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

beforeEach(() => {
  vi.resetAllMocks();
  savedTvToken.mockReturnValue(null);
  linkExists.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TvPlayer - entrar", () => {
  it("link que nao existe avisa e nao pede codigo", async () => {
    linkExists.mockResolvedValue(false);
    abrir();

    expect(await screen.findByText("Link não encontrado")).toBeTruthy();
    expect(screen.queryByLabelText("Código de acesso")).toBeNull();
  });

  it("sem conexao guardada, pede o codigo", async () => {
    abrir();

    expect(await screen.findByRole("heading", { name: "Conectar esta TV" })).toBeTruthy();
    expect(fetchPlaylist).not.toHaveBeenCalled();
  });

  it("so deixa conectar com os 6 digitos e ignora o que nao e numero", async () => {
    abrir();
    await screen.findByLabelText("Código de acesso");

    digitar("12ab3");
    expect((screen.getByLabelText("Código de acesso") as HTMLInputElement).value).toBe("123");
    expect((screen.getByRole("button", { name: "Conectar" }) as HTMLButtonElement).disabled).toBe(true);

    digitar("1234567");
    expect((screen.getByLabelText("Código de acesso") as HTMLInputElement).value).toBe("123456");
    expect((screen.getByRole("button", { name: "Conectar" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("codigo errado mostra o aviso e limpa o campo", async () => {
    connectTv.mockRejectedValue({ response: { status: 403 } });
    abrir();
    await screen.findByLabelText("Código de acesso");

    digitar("111111");
    enviar();

    expect((await screen.findByRole("alert")).textContent).toContain("Código incorreto");
    expect((screen.getByLabelText("Código de acesso") as HTMLInputElement).value).toBe("");
  });

  it("muitas tentativas erradas avisa para esperar", async () => {
    connectTv.mockRejectedValue({ response: { status: 429 } });
    abrir();
    await screen.findByLabelText("Código de acesso");

    digitar("111111");
    enviar();

    expect((await screen.findByRole("alert")).textContent).toContain("Muitas tentativas");
  });

  it("codigo certo conecta e passa o primeiro item", async () => {
    connectTv.mockResolvedValue("token-novo");
    fetchPlaylist.mockResolvedValue({ name: "Recepcao", items: [RELATORIO] });
    abrir();
    await screen.findByLabelText("Código de acesso");

    digitar("123456");
    enviar();

    expect((await screen.findByTestId("embed")).textContent).toBe("embed 10 pagina ReportSection2");
    expect(connectTv).toHaveBeenCalledWith("segredo123", "123456");
    expect(fetchPlaylist).toHaveBeenCalledWith("token-novo");
  });

  it("com a conexao guardada, entra direto sem pedir codigo", async () => {
    savedTvToken.mockReturnValue("token-guardado");
    fetchPlaylist.mockResolvedValue({ name: "Recepcao", items: [IMAGEM] });
    abrir();

    await waitFor(() => expect(imagem()).not.toBeNull());
    expect(screen.queryByLabelText("Código de acesso")).toBeNull();
    expect(linkExists).not.toHaveBeenCalled();
  });

  it("conexao guardada que o servidor recusou: esquece e pede o codigo de novo", async () => {
    savedTvToken.mockReturnValue("token-velho");
    fetchPlaylist.mockRejectedValue({ response: { status: 401 } });
    abrir();

    expect(await screen.findByText(/A conexão desta TV acabou/)).toBeTruthy();
    expect(forgetTvToken).toHaveBeenCalledWith("segredo123");
    expect(screen.getByLabelText("Código de acesso")).toBeTruthy();
  });

  it("sem rede ao abrir, nao pede o codigo a toa: segue tentando com a conexao guardada", async () => {
    savedTvToken.mockReturnValue("token-guardado");
    fetchPlaylist.mockRejectedValue(new Error("Network Error"));
    abrir();

    expect(await screen.findByText("Nada para mostrar ainda")).toBeTruthy();
    expect(screen.queryByLabelText("Código de acesso")).toBeNull();
    expect(forgetTvToken).not.toHaveBeenCalled();
  });
});

describe("TvPlayer - passar a programacao", () => {
  beforeEach(() => {
    savedTvToken.mockReturnValue("tk");
  });

  async function comItens(items: PlayerItem[]) {
    fetchPlaylist.mockResolvedValue({ name: "Recepcao", items });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    abrir();
    await waitFor(() => expect(fetchPlaylist).toHaveBeenCalled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  const avancar = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("cada item fica o tempo dele e depois passa para o proximo, voltando ao primeiro no fim", async () => {
    await comItens([RELATORIO, IMAGEM, VIDEO]);
    expect(screen.getByTestId("embed")).toBeTruthy();

    await avancar(19_000);
    expect(screen.getByTestId("embed")).toBeTruthy();
    await avancar(1_500);
    expect(imagem()).not.toBeNull(); // imagem: 5 s

    await avancar(5_200);
    expect(document.querySelector("iframe")).not.toBeNull(); // video: 40 s

    await avancar(40_200);
    expect(screen.getByTestId("embed")).toBeTruthy(); // voltou ao primeiro
  });

  it("o video do YouTube toca mudo ou com som conforme a configuracao do item", async () => {
    await comItens([{ ...VIDEO, sound: false }]);
    expect(document.querySelector("iframe")!.getAttribute("src")).toContain("mute=1");
  });

  it("video com som pedido nao vai mudo", async () => {
    await comItens([VIDEO]);

    const src = document.querySelector("iframe")!.getAttribute("src")!;

    expect(src).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(src).toContain("mute=0");
    expect(src).toContain("autoplay=1");
  });

  it("a pagina do relatorio abre exatamente a pagina do item", async () => {
    await comItens([RELATORIO]);

    expect(screen.getByTestId("embed").textContent).toContain("ReportSection2");
  });

  it("as setas trocam de item e o espaco pausa a rotacao", async () => {
    await comItens([RELATORIO, IMAGEM]);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(imagem()).not.toBeNull();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("embed")).toBeTruthy();

    fireEvent.keyDown(window, { key: " " });
    await avancar(60_000);
    expect(screen.getByTestId("embed")).toBeTruthy(); // pausado: nao trocou
  });

  it("com um item so, nao troca nem mostra a barra de progresso", async () => {
    await comItens([IMAGEM]);

    await avancar(30_000);

    expect(imagem()).not.toBeNull();
    expect(document.querySelector(".slideshow-progress")).toBeNull();
  });

  it("lista vazia avisa que nao ha nada para mostrar", async () => {
    await comItens([]);

    expect(screen.getByText("Nada para mostrar ainda")).toBeTruthy();
  });

  it("confere a lista de tempos em tempos e passa a mostrar o que mudou", async () => {
    await comItens([IMAGEM]);
    fetchPlaylist.mockResolvedValue({ name: "Recepcao", items: [{ ...IMAGEM, image_url: "/static/uploads/tv/nova.png" }] });

    await avancar(3 * 60 * 1000 + 500);

    await waitFor(() => expect(imagem().getAttribute("src")).toContain("nova.png"));
  });

  it("se o servidor encerrar a conexao na conferencia, volta para a tela do codigo", async () => {
    await comItens([IMAGEM]);
    fetchPlaylist.mockRejectedValue({ response: { status: 401 } });

    await avancar(3 * 60 * 1000 + 500);

    expect(await screen.findByText(/foi encerrada/)).toBeTruthy();
    expect(forgetTvToken).toHaveBeenCalled();
  });

  it("falha de rede na conferencia nao derruba a tela: segue mostrando o que ja tem", async () => {
    await comItens([IMAGEM]);
    fetchPlaylist.mockRejectedValue(new Error("Network Error"));

    await avancar(3 * 60 * 1000 + 500);

    expect(imagem()).not.toBeNull();
    expect(forgetTvToken).not.toHaveBeenCalled();
  });
});

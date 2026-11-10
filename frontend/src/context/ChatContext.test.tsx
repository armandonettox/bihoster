import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as chatApi from "../api/aiChat";
import type { ChatResponse } from "../api/aiChat";
import * as aiReportApi from "../api/aiReport";
import { ChatProvider, useChat, type OpenReport } from "./ChatContext";

const mocks = vi.hoisted(() => ({ canUse: true }));

vi.mock("./ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../hooks/useAiAccess", () => ({
  useAiAccess: () => ({ canManage: false, canUse: mocks.canUse, loading: false }),
}));
vi.mock("../api/aiChat", () => ({
  sendChatMessage: vi.fn(),
  listConversations: vi.fn().mockResolvedValue([]),
  getConversation: vi.fn(),
  deleteConversation: vi.fn(),
  deleteAllConversations: vi.fn(),
}));
vi.mock("../api/aiReport", () => ({ warmPageImage: vi.fn() }));

const send = vi.mocked(chatApi.sendChatMessage);
const warm = vi.mocked(aiReportApi.warmPageImage);

const RESPOSTA: ChatResponse = {
  conversation_id: 7,
  conversation_title: "Qual o total?",
  reply: "O total foi 99.",
  report: null,
  dax: null,
  table: null,
  usage: { provider: "openrouter", model: "m", llm_calls: 2, input_tokens: 1, output_tokens: 1, cost_usd: null },
};

const CONTEXTO = {
  page_name: "ReportSection1",
  page_title: "Carteira",
  visuals: [{ title: "Vidas por unidade", type: "barChart", fields: ["dim_unidade[uf]", "[Vidas Ativas]"] }],
};

function aberto(parcial: Partial<OpenReport> = {}): OpenReport {
  return {
    reportId: 34,
    getPageName: vi.fn().mockResolvedValue("ReportSection1"),
    getContext: vi.fn().mockResolvedValue(CONTEXTO),
    ...parcial,
  };
}

function Consumidor({ relatorio }: { relatorio?: OpenReport }) {
  const chat = useChat();
  return (
    <div>
      <button onClick={() => chat.setPanelOpen(!chat.panelOpen)}>alternar painel</button>
      <button onClick={() => chat.setOpenReport(relatorio ?? null)}>registrar relatorio</button>
      <button onClick={() => chat.setOpenReport(null)}>tirar relatorio</button>
      <input aria-label="pergunta" value={chat.input} onChange={(e) => chat.setInput(e.target.value)} />
      <button onClick={() => void chat.sendMessage()}>enviar</button>
      {chat.items.map((item) => (
        <p key={item.key}>{item.usedImage ? `${item.content} [imagem]` : item.content}</p>
      ))}
    </div>
  );
}

function montar(relatorio?: OpenReport) {
  return render(
    <ChatProvider>
      <Consumidor relatorio={relatorio} />
    </ChatProvider>,
  );
}

function perguntar(texto = "Qual o total?") {
  fireEvent.change(screen.getByLabelText("pergunta"), { target: { value: texto } });
  fireEvent.click(screen.getByText("enviar"));
}

beforeEach(() => {
  mocks.canUse = true;
  send.mockReset();
  send.mockResolvedValue(RESPOSTA);
  warm.mockReset();
  warm.mockResolvedValue("warming");
});

afterEach(() => vi.useRealTimers());

describe("ChatContext - pagina aberta", () => {
  it("sem relatorio aberto a pergunta vai como sempre, sem pagina", async () => {
    montar();

    perguntar();

    await screen.findByText("O total foi 99.");
    expect(send).toHaveBeenCalledWith("Qual o total?", undefined);
    expect(warm).not.toHaveBeenCalled();
  });

  it("com relatorio aberto manda a pagina ativa e os campos dos graficos junto da pergunta", async () => {
    const relatorio = aberto();
    montar(relatorio);
    fireEvent.click(screen.getByText("registrar relatorio"));

    perguntar();

    await screen.findByText("O total foi 99.");
    expect(send).toHaveBeenCalledWith("Qual o total?", undefined, {
      report_id: 34,
      page_name: "ReportSection1",
      page_title: "Carteira",
      visuals: CONTEXTO.visuals,
    });
  });

  it("se ler os graficos falha, manda so o relatorio e a pergunta segue", async () => {
    const relatorio = aberto({ getContext: vi.fn().mockRejectedValue(new Error("sem permissao")) });
    montar(relatorio);
    fireEvent.click(screen.getByText("registrar relatorio"));

    perguntar();

    await screen.findByText("O total foi 99.");
    expect(send).toHaveBeenCalledWith("Qual o total?", undefined, { report_id: 34, page_name: null, page_title: null, visuals: [] });
  });

  it("relatorio ainda carregando (contexto nulo) manda so o relatorio", async () => {
    montar(aberto({ getContext: vi.fn().mockResolvedValue(null) }));
    fireEvent.click(screen.getByText("registrar relatorio"));

    perguntar();

    await screen.findByText("O total foi 99.");
    expect(send.mock.calls[0][2]).toEqual({ report_id: 34, page_name: null, page_title: null, visuals: [] });
  });

  it("se ler os graficos demora demais, a pergunta segue sem eles depois de 8 segundos", async () => {
    vi.useFakeTimers();
    montar(aberto({ getContext: vi.fn(() => new Promise<null>(() => {})) }));
    fireEvent.click(screen.getByText("registrar relatorio"));

    perguntar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7999);
    });
    expect(send).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });

    expect(send.mock.calls[0][2]).toEqual({ report_id: 34, page_name: null, page_title: null, visuals: [] });
  });

  it("tirado o relatorio aberto, a pergunta volta a ir sem pagina", async () => {
    montar(aberto());
    fireEvent.click(screen.getByText("registrar relatorio"));
    fireEvent.click(screen.getByText("tirar relatorio"));

    perguntar();

    await screen.findByText("O total foi 99.");
    expect(send).toHaveBeenCalledWith("Qual o total?", undefined);
  });

  it("avisa na mensagem quando a imagem da pagina foi enviada ao provedor", async () => {
    send.mockResolvedValue({ ...RESPOSTA, used_image: true });
    montar();

    perguntar();

    expect(await screen.findByText("O total foi 99. [imagem]")).toBeTruthy();
  });
});

describe("ChatContext - imagem da pagina", () => {
  it("abrir o painel dentro de um relatorio ja pede a imagem da pagina ativa", async () => {
    montar(aberto());
    fireEvent.click(screen.getByText("registrar relatorio"));

    fireEvent.click(screen.getByText("alternar painel"));

    await waitFor(() => expect(warm).toHaveBeenCalledWith(34, "ReportSection1"));
  });

  it("nao pede de novo a mesma pagina dentro de dez minutos", async () => {
    montar(aberto());
    fireEvent.click(screen.getByText("registrar relatorio"));
    fireEvent.click(screen.getByText("alternar painel"));
    await waitFor(() => expect(warm).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("alternar painel"));
    fireEvent.click(screen.getByText("alternar painel"));
    perguntar();
    await screen.findByText("O total foi 99.");

    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("perguntar tambem pede a imagem, para as proximas perguntas", async () => {
    montar(aberto());
    fireEvent.click(screen.getByText("registrar relatorio"));

    perguntar();

    await screen.findByText("O total foi 99.");
    await waitFor(() => expect(warm).toHaveBeenCalledWith(34, "ReportSection1"));
  });

  it("sem permissao de usar o chat nao pede imagem ao abrir o painel", async () => {
    mocks.canUse = false;
    montar(aberto());
    fireEvent.click(screen.getByText("registrar relatorio"));

    fireEvent.click(screen.getByText("alternar painel"));
    await act(async () => {});

    expect(warm).not.toHaveBeenCalled();
  });

  it("pagina sem nome tecnico nao pede imagem", async () => {
    montar(aberto({ getPageName: vi.fn().mockResolvedValue(null) }));
    fireEvent.click(screen.getByText("registrar relatorio"));

    fireEvent.click(screen.getByText("alternar painel"));
    await act(async () => {});

    expect(warm).not.toHaveBeenCalled();
  });

  it("falha ao pedir a imagem nao atrapalha a pergunta", async () => {
    warm.mockRejectedValue(new Error("502"));
    montar(aberto());
    fireEvent.click(screen.getByText("registrar relatorio"));

    perguntar();

    expect(await screen.findByText("O total foi 99.")).toBeTruthy();
  });

  it("fora de um relatorio aberto nunca pede imagem", async () => {
    montar();

    fireEvent.click(screen.getByText("alternar painel"));
    perguntar();
    await screen.findByText("O total foi 99.");

    expect(warm).not.toHaveBeenCalled();
  });
});

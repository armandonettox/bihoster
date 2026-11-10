import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as chatApi from "../api/aiChat";
import type { ChatResponse, Conversation } from "../api/aiChat";
import { ChatProvider } from "../context/ChatContext";
import ChatPage from "./ChatPage";

const mocks = vi.hoisted(() => ({ showToast: vi.fn(), canUse: true, loading: false }));

vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../hooks/useAiAccess", () => ({
  useAiAccess: () => ({ canManage: false, canUse: mocks.canUse, loading: mocks.loading }),
}));
vi.mock("../api/aiChat", () => ({
  sendChatMessage: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  deleteConversation: vi.fn(),
  deleteAllConversations: vi.fn(),
}));

const send = vi.mocked(chatApi.sendChatMessage);
const list = vi.mocked(chatApi.listConversations);
const getConv = vi.mocked(chatApi.getConversation);
const delOne = vi.mocked(chatApi.deleteConversation);
const delAll = vi.mocked(chatApi.deleteAllConversations);

const CONVERSA: Conversation = { id: 7, title: "Qual o total?", created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T10:00:00Z" };
const OUTRA: Conversation = { id: 8, title: "Vendas por mes", created_at: "2026-11-09T10:00:00Z", updated_at: "2026-11-09T10:00:00Z" };

const RESPOSTA: ChatResponse = {
  conversation_id: 7,
  conversation_title: "Qual o total?",
  reply: "O total foi 99.",
  report: { id: 3, name: "Vendas do mes" },
  dax: 'EVALUATE ROW("t", [Total])',
  table: { columns: ["[Total]"], rows: [{ "[Total]": 99 }], total_rows: 1, truncated: false },
  usage: { provider: "openrouter", model: "m", llm_calls: 2, input_tokens: 24, output_tokens: 8, cost_usd: null },
};

const renderChat = () =>
  render(
    <ChatProvider>
      <ChatPage />
    </ChatProvider>,
  );

const caixa = () => screen.getByLabelText("Sua pergunta") as HTMLTextAreaElement;
const botaoEnviar = () => screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement;

function escrever(texto: string) {
  fireEvent.change(caixa(), { target: { value: texto } });
}

async function abrir(conversas: Conversation[] = []) {
  list.mockResolvedValue(conversas);
  renderChat();
  await screen.findByLabelText("Sua pergunta");
  if (conversas.length) await screen.findByText(conversas[0].title);
}

beforeEach(() => {
  mocks.showToast.mockClear();
  mocks.canUse = true;
  mocks.loading = false;
  send.mockReset();
  list.mockReset();
  getConv.mockReset();
  delOne.mockReset();
  delAll.mockReset();
});

describe("ChatPage - acesso", () => {
  it("sem a permissao mostra o aviso e nao carrega nada", () => {
    mocks.canUse = false;
    renderChat();

    expect(screen.getByText(/Voce nao tem permissao para usar o chat de IA/)).toBeTruthy();
    expect(screen.queryByLabelText("Sua pergunta")).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("enquanto confere a permissao nao mostra o chat nem o aviso", () => {
    mocks.loading = true;
    renderChat();

    expect(screen.queryByLabelText("Sua pergunta")).toBeNull();
    expect(screen.queryByText(/nao tem permissao/)).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });
});

describe("ChatPage - tela inicial", () => {
  it("mostra a orientacao e o aviso de RLS quando nao ha mensagens", async () => {
    await abrir();

    expect(screen.getByText("Pergunte sobre os dados dos seus relatorios")).toBeTruthy();
    expect(screen.getByText(/seguranca por linha/)).toBeTruthy();
    expect(screen.getByText("Nenhuma conversa ainda.")).toBeTruthy();
  });

  it("lista as conversas do historico", async () => {
    await abrir([CONVERSA, OUTRA]);

    expect(screen.getByText("Qual o total?")).toBeTruthy();
    expect(screen.getByText("Vendas por mes")).toBeTruthy();
  });

  it("avisa quando nao consegue carregar o historico", async () => {
    list.mockRejectedValue(new Error("500"));
    renderChat();

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Nao foi possivel carregar o historico.", "error"));
  });
});

describe("ChatPage - enviar", () => {
  it("manda a pergunta e mostra a resposta com relatorio, tabela e DAX", async () => {
    send.mockResolvedValue(RESPOSTA);
    await abrir();
    escrever("  Qual o total?  ");

    fireEvent.click(botaoEnviar());

    expect(await screen.findByText("O total foi 99.")).toBeTruthy();
    expect(send).toHaveBeenCalledWith("Qual o total?", undefined);
    expect(screen.getByText("Qual o total?", { selector: ".chat-text" })).toBeTruthy();
    expect(screen.getByText("Vendas do mes")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("99")).toBeTruthy();
    expect(screen.getByText("Ver consulta DAX")).toBeTruthy();
    expect(screen.getByText('EVALUATE ROW("t", [Total])')).toBeTruthy();
    expect(caixa().value).toBe("");
  });

  it("a conversa nova aparece na lista depois da resposta", async () => {
    send.mockResolvedValue(RESPOSTA);
    list.mockResolvedValueOnce([]).mockResolvedValue([CONVERSA]);
    renderChat();
    await screen.findByLabelText("Sua pergunta");
    escrever("Qual o total?");

    fireEvent.click(botaoEnviar());

    await waitFor(() => expect(within(screen.getByLabelText("Conversas")).getByText("Qual o total?")).toBeTruthy());
  });

  it("a segunda pergunta continua a mesma conversa", async () => {
    send.mockResolvedValue(RESPOSTA);
    await abrir();
    escrever("Primeira");
    fireEvent.click(botaoEnviar());
    await screen.findByText("O total foi 99.");

    escrever("E por mes?");
    fireEvent.click(botaoEnviar());

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]).toEqual(["E por mes?", 7]);
  });

  it("Enter envia", async () => {
    send.mockResolvedValue(RESPOSTA);
    await abrir();
    escrever("Qual o total?");

    fireEvent.keyDown(caixa(), { key: "Enter" });

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  });

  it("Shift+Enter quebra a linha e nao envia", async () => {
    await abrir();
    escrever("Qual o total?");

    fireEvent.keyDown(caixa(), { key: "Enter", shiftKey: true });

    expect(send).not.toHaveBeenCalled();
  });

  it("mensagem em branco nao envia", async () => {
    await abrir();

    expect(botaoEnviar().disabled).toBe(true);
    escrever("   ");
    expect(botaoEnviar().disabled).toBe(true);
    fireEvent.keyDown(caixa(), { key: "Enter" });
    expect(send).not.toHaveBeenCalled();
  });

  it("mostra o indicador de espera e trava o envio enquanto espera a resposta", async () => {
    let responder: (value: ChatResponse) => void = () => {};
    send.mockReturnValue(new Promise((resolve) => (responder = resolve)));
    await abrir();
    escrever("Qual o total?");

    fireEvent.click(botaoEnviar());

    expect(await screen.findByText("Escolhendo o relatorio")).toBeTruthy();
    escrever("outra coisa");
    expect(botaoEnviar().disabled).toBe(true);
    fireEvent.keyDown(caixa(), { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);

    responder(RESPOSTA);
    await waitFor(() => expect(screen.queryByText("Escolhendo o relatorio")).toBeNull());
  });

  it("mostra o motivo da falha como aviso e devolve o texto para a caixa", async () => {
    send.mockRejectedValue({ response: { data: { detail: "Voce atingiu o limite de 50 perguntas por dia. Tente novamente amanha." } } });
    await abrir();
    escrever("Qual o total?");

    fireEvent.click(botaoEnviar());

    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent).toContain("limite de 50 perguntas por dia");
    expect(caixa().value).toBe("Qual o total?");
  });

  it("falha sem mensagem do servidor mostra um texto padrao", async () => {
    send.mockRejectedValue(new Error("rede"));
    await abrir();
    escrever("Qual o total?");

    fireEvent.click(botaoEnviar());

    expect((await screen.findByRole("alert")).textContent).toContain("Nao foi possivel obter a resposta");
  });

  it("resposta sem tabela nem DAX (recusa ou bloqueio) nao mostra esses blocos", async () => {
    send.mockResolvedValue({ ...RESPOSTA, reply: "Esse relatorio usa seguranca por linha (RLS).", dax: null, table: null });
    await abrir();
    escrever("Qual o total?");

    fireEvent.click(botaoEnviar());

    expect(await screen.findByText(/usa seguranca por linha/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Ver consulta DAX")).toBeNull();
  });

  it("texto da resposta que parece HTML entra como texto", async () => {
    send.mockResolvedValue({ ...RESPOSTA, reply: "<img src=x onerror=alert(1)>", table: null, dax: null });
    list.mockResolvedValue([]);
    const { container } = renderChat();
    await screen.findByLabelText("Sua pergunta");
    escrever("oi");

    fireEvent.click(botaoEnviar());

    expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("ChatPage - estado compartilhado", () => {
  it("a conversa e o texto digitado continuam ao sair da pagina e voltar", async () => {
    list.mockResolvedValue([]);
    send.mockResolvedValue(RESPOSTA);
    const { rerender } = render(
      <ChatProvider>
        <ChatPage />
      </ChatProvider>,
    );
    await screen.findByLabelText("Sua pergunta");
    escrever("Qual o total?");
    fireEvent.click(botaoEnviar());
    expect(await screen.findByText("O total foi 99.")).toBeTruthy();
    escrever("rascunho");

    // A pagina sai de cena, o provedor (no Layout) continua
    rerender(
      <ChatProvider>
        <p>outra pagina</p>
      </ChatProvider>,
    );
    expect(screen.queryByLabelText("Sua pergunta")).toBeNull();
    rerender(
      <ChatProvider>
        <ChatPage />
      </ChatProvider>,
    );

    expect(await screen.findByText("O total foi 99.")).toBeTruthy();
    expect(caixa().value).toBe("rascunho");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("ChatPage - historico", () => {
  const DETALHE = {
    ...CONVERSA,
    messages: [
      { id: 1, role: "user" as const, content: "Qual o total?", report: null, dax: null, created_at: "2026-11-10T10:00:00Z" },
      {
        id: 2,
        role: "assistant" as const,
        content: "O total foi 99.",
        report: { id: 3, name: "Vendas do mes" },
        dax: 'EVALUATE ROW("t", [Total])',
        created_at: "2026-11-10T10:00:01Z",
      },
    ],
  };

  it("abrir uma conversa mostra as mensagens, o DAX e o aviso de que a tabela nao fica guardada", async () => {
    getConv.mockResolvedValue(DETALHE);
    await abrir([CONVERSA]);

    fireEvent.click(within(screen.getByLabelText("Conversas")).getByText("Qual o total?"));

    expect(await screen.findByText("O total foi 99.")).toBeTruthy();
    expect(getConv).toHaveBeenCalledWith(7);
    expect(screen.getByText("Vendas do mes")).toBeTruthy();
    expect(screen.getByText("Ver consulta DAX")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/A tabela nao fica guardada no historico/)).toBeTruthy();
  });

  it("continuar uma conversa aberta do historico manda o id dela", async () => {
    getConv.mockResolvedValue(DETALHE);
    send.mockResolvedValue(RESPOSTA);
    await abrir([CONVERSA]);
    fireEvent.click(within(screen.getByLabelText("Conversas")).getByText("Qual o total?"));
    await screen.findByText("O total foi 99.");

    escrever("E por mes?");
    fireEvent.click(botaoEnviar());

    await waitFor(() => expect(send).toHaveBeenCalledWith("E por mes?", 7));
  });

  it("avisa quando nao consegue abrir a conversa", async () => {
    getConv.mockRejectedValue({ response: { data: { detail: "Conversa nao encontrada" } } });
    await abrir([CONVERSA]);

    fireEvent.click(within(screen.getByLabelText("Conversas")).getByText("Qual o total?"));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Conversa nao encontrada", "error"));
  });

  it("nova conversa limpa a tela e a proxima pergunta nao leva id", async () => {
    getConv.mockResolvedValue(DETALHE);
    send.mockResolvedValue(RESPOSTA);
    await abrir([CONVERSA]);
    fireEvent.click(within(screen.getByLabelText("Conversas")).getByText("Qual o total?"));
    await screen.findByText("O total foi 99.");

    fireEvent.click(screen.getByRole("button", { name: "Nova conversa" }));

    expect(screen.queryByText("O total foi 99.")).toBeNull();
    expect(screen.getByText("Pergunte sobre os dados dos seus relatorios")).toBeTruthy();
    escrever("Outra pergunta");
    fireEvent.click(botaoEnviar());
    await waitFor(() => expect(send).toHaveBeenCalledWith("Outra pergunta", undefined));
  });
});

describe("ChatPage - apagar", () => {
  it("pede confirmacao e so apaga depois", async () => {
    delOne.mockResolvedValue(undefined);
    await abrir([CONVERSA, OUTRA]);

    fireEvent.click(screen.getByLabelText("Apagar a conversa Vendas por mes"));
    expect(delOne).not.toHaveBeenCalled();
    expect(screen.getByText(/Apagar a conversa "Vendas por mes"\?/)).toBeTruthy();
    list.mockResolvedValue([CONVERSA]);
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));

    await waitFor(() => expect(delOne).toHaveBeenCalledWith(8));
    await waitFor(() => expect(screen.queryByText("Vendas por mes")).toBeNull());
    expect(mocks.showToast).toHaveBeenCalledWith("Conversa apagada.");
  });

  it("cancelar nao apaga nada", async () => {
    await abrir([CONVERSA]);

    fireEvent.click(screen.getByLabelText("Apagar a conversa Qual o total?"));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(delOne).not.toHaveBeenCalled();
    expect(screen.queryByText(/Isso nao pode ser desfeito/)).toBeNull();
  });

  it("apagar a conversa aberta limpa a tela", async () => {
    delOne.mockResolvedValue(undefined);
    getConv.mockResolvedValue({
      ...CONVERSA,
      messages: [{ id: 1, role: "user", content: "Pergunta antiga", report: null, dax: null, created_at: "2026-11-10T10:00:00Z" }],
    });
    await abrir([CONVERSA]);
    fireEvent.click(within(screen.getByLabelText("Conversas")).getByText("Qual o total?"));
    await screen.findByText("Pergunta antiga");
    list.mockResolvedValue([]);

    fireEvent.click(screen.getByLabelText("Apagar a conversa Qual o total?"));
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));

    await waitFor(() => expect(screen.queryByText("Pergunta antiga")).toBeNull());
  });

  it("mostra o motivo quando nao consegue apagar", async () => {
    delOne.mockRejectedValue({ response: { data: { detail: "Conversa nao encontrada" } } });
    await abrir([CONVERSA]);

    fireEvent.click(screen.getByLabelText("Apagar a conversa Qual o total?"));
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Conversa nao encontrada", "error"));
  });

  it("apagar todo o historico pede confirmacao e esvazia a lista", async () => {
    delAll.mockResolvedValue(undefined);
    await abrir([CONVERSA, OUTRA]);

    fireEvent.click(screen.getByRole("button", { name: "Apagar todo o historico" }));
    expect(delAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apagar tudo" }));

    await waitFor(() => expect(delAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Nenhuma conversa ainda.")).toBeTruthy());
    expect(mocks.showToast).toHaveBeenCalledWith("Historico apagado.");
  });

  it("sem conversas nao oferece apagar tudo", async () => {
    await abrir();

    expect(screen.queryByRole("button", { name: "Apagar todo o historico" })).toBeNull();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as chatApi from "../api/aiChat";
import type { ChatResponse, Conversation } from "../api/aiChat";
import { ChatProvider } from "../context/ChatContext";
import ChatPanel from "./ChatPanel";
import ChatPanelToggle from "./ChatPanelToggle";

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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ChatProvider>
        <ChatPanelToggle />
        <ChatPanel />
      </ChatProvider>
    </MemoryRouter>,
  );
}

const botaoToggle = () => screen.getByRole("button", { name: /chat ao lado|chat lateral/ });

beforeEach(() => {
  mocks.showToast.mockClear();
  mocks.canUse = true;
  mocks.loading = false;
  send.mockReset();
  list.mockReset();
  getConv.mockReset();
  list.mockResolvedValue([CONVERSA, OUTRA]);
});

describe("ChatPanelToggle", () => {
  it("sem a permissao de usar o chat o botao nao aparece", () => {
    mocks.canUse = false;
    renderAt("/collection");

    expect(screen.queryByRole("button", { name: /chat ao lado|chat lateral/ })).toBeNull();
  });

  it("na pagina /chat o botao nao aparece, ela ja e o chat em tela cheia", () => {
    renderAt("/chat");

    expect(screen.queryByRole("button", { name: /chat ao lado|chat lateral/ })).toBeNull();
  });

  it("o painel comeca fechado e o botao abre e fecha", async () => {
    renderAt("/collection");
    expect(screen.queryByLabelText("Sua pergunta")).toBeNull();

    fireEvent.click(botaoToggle());
    expect(await screen.findByLabelText("Sua pergunta")).toBeTruthy();
    expect(botaoToggle().getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(botaoToggle());
    expect(screen.queryByLabelText("Sua pergunta")).toBeNull();
  });
});

describe("ChatPanel", () => {
  it("ao abrir carrega as conversas na lista suspensa", async () => {
    renderAt("/collection");
    fireEvent.click(botaoToggle());

    const select = (await screen.findByLabelText("Conversa")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3));
    expect(Array.from(select.options).map((o) => o.text)).toEqual(["Nova conversa", "Qual o total?", "Vendas por mes"]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("escolher uma conversa na lista abre as mensagens dela", async () => {
    getConv.mockResolvedValue({
      ...OUTRA,
      messages: [
        { id: 1, role: "user" as const, content: "Vendas por mes?", report: null, dax: null, created_at: "2026-11-09T10:00:00Z" },
        { id: 2, role: "assistant" as const, content: "Foram 12 meses.", report: null, dax: null, created_at: "2026-11-09T10:00:01Z" },
      ],
    });
    renderAt("/collection");
    fireEvent.click(botaoToggle());
    const select = (await screen.findByLabelText("Conversa")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3));

    fireEvent.change(select, { target: { value: "8" } });

    expect(await screen.findByText("Foram 12 meses.")).toBeTruthy();
    expect(getConv).toHaveBeenCalledWith(8);
  });

  it("enviar uma pergunta no painel mostra a resposta e a conversa fica ativa na lista", async () => {
    send.mockResolvedValue(RESPOSTA);
    renderAt("/collection");
    fireEvent.click(botaoToggle());

    fireEvent.change(await screen.findByLabelText("Sua pergunta"), { target: { value: "Qual o total?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText("O total foi 99.")).toBeTruthy();
    expect(send).toHaveBeenCalledWith("Qual o total?", undefined);
    await waitFor(() => expect((screen.getByLabelText("Conversa") as HTMLSelectElement).value).toBe("7"));
  });

  it("o botao de fechar esconde o painel", async () => {
    renderAt("/collection");
    fireEvent.click(botaoToggle());
    await screen.findByLabelText("Sua pergunta");

    fireEvent.click(screen.getByRole("button", { name: "Fechar o chat" }));

    expect(screen.queryByLabelText("Sua pergunta")).toBeNull();
  });

  it("tela cheia leva para /chat e fecha o painel", async () => {
    renderAt("/collection");
    fireEvent.click(botaoToggle());
    const link = await screen.findByRole("link", { name: "Abrir em tela cheia" });
    expect(link.getAttribute("href")).toBe("/chat");

    fireEvent.click(link);

    // Na pagina /chat nem o painel nem o botao aparecem
    expect(screen.queryByLabelText("Sua pergunta")).toBeNull();
    expect(screen.queryByRole("button", { name: /chat ao lado|chat lateral/ })).toBeNull();
  });
});

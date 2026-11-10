import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import * as chatApi from "../api/aiChat";
import type { Conversation } from "../api/aiChat";
import { extractErrorMessage } from "../api/client";
import { useAiAccess } from "../hooks/useAiAccess";
import { useToast } from "./ToastContext";
import type { ChatItem } from "../components/ChatMessageView";

let nextKey = 0;
const newKey = () => `m${nextKey++}`;

interface ChatContextValue {
  canUse: boolean;
  accessLoading: boolean;
  conversations: Conversation[];
  activeId: number | null;
  items: ChatItem[];
  input: string;
  setInput: (value: string) => void;
  sending: boolean;
  loadConversations: () => Promise<void>;
  sendMessage: () => Promise<void>;
  newConversation: () => void;
  openConversation: (conversation: Conversation) => Promise<void>;
  deleteConversation: (conversation: Conversation) => Promise<void>;
  deleteAllConversations: () => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/** Estado do chat de IA, fora das telas: a pagina /chat e o painel lateral mostram a mesma conversa, e ela
 * continua aberta (e a resposta continua chegando) quando a pessoa troca de pagina. */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { canUse, loading: accessLoading } = useAiAccess();
  const { showToast } = useToast();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // Impede dois envios ao mesmo tempo mesmo antes de o estado "sending" chegar a tela
  const sendingRef = useRef(false);

  async function loadConversations() {
    try {
      setConversations(await chatApi.listConversations());
    } catch {
      showToast("Nao foi possivel carregar o historico.", "error");
    }
  }

  async function sendMessage() {
    const message = input.trim();
    if (!message || sendingRef.current) return;

    sendingRef.current = true;
    setInput("");
    setSending(true);
    setItems((current) => [...current, { key: newKey(), role: "user", content: message }]);
    try {
      const response = await chatApi.sendChatMessage(message, activeId ?? undefined);
      setActiveId(response.conversation_id);
      setItems((current) => [
        ...current,
        {
          key: newKey(),
          role: "assistant",
          content: response.reply,
          report: response.report,
          dax: response.dax,
          table: response.table,
        },
      ]);
      await loadConversations();
    } catch (err: any) {
      // A pergunta nao foi guardada: volta para a caixa de texto, para tentar de novo sem redigitar
      setInput(message);
      setItems((current) => [
        ...current,
        {
          key: newKey(),
          role: "assistant",
          content: extractErrorMessage(err) || "Nao foi possivel obter a resposta. Tente de novo.",
          error: true,
        },
      ]);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function newConversation() {
    setActiveId(null);
    setItems([]);
    setInput("");
  }

  async function openConversation(conversation: Conversation) {
    try {
      const detail = await chatApi.getConversation(conversation.id);
      setActiveId(detail.id);
      setItems(
        detail.messages.map((m) => ({
          key: `h${m.id}`,
          role: m.role,
          content: m.content,
          report: m.report,
          dax: m.dax,
          fromHistory: true,
        })),
      );
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel abrir a conversa.", "error");
    }
  }

  async function deleteConversation(conversation: Conversation) {
    try {
      await chatApi.deleteConversation(conversation.id);
      if (activeId === conversation.id) newConversation();
      await loadConversations();
      showToast("Conversa apagada.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel apagar a conversa.", "error");
    }
  }

  async function deleteAllConversations() {
    try {
      await chatApi.deleteAllConversations();
      newConversation();
      setConversations([]);
      showToast("Historico apagado.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel apagar o historico.", "error");
    }
  }

  return (
    <ChatContext.Provider
      value={{
        canUse,
        accessLoading,
        conversations,
        activeId,
        items,
        input,
        setInput,
        sending,
        loadConversations,
        sendMessage,
        newConversation,
        openConversation,
        deleteConversation,
        deleteAllConversations,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat precisa estar dentro de ChatProvider");
  return value;
}

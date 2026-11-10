import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import * as chatApi from "../api/aiChat";
import type { Conversation, OpenPageInfo, PageVisualInfo } from "../api/aiChat";
import * as aiReportApi from "../api/aiReport";
import { extractErrorMessage } from "../api/client";
import { useAiAccess } from "../hooks/useAiAccess";
import { useToast } from "./ToastContext";
import type { ChatItem } from "../components/ChatMessageView";

let nextKey = 0;
const newKey = () => `m${nextKey++}`;

// A imagem fica 15 min no servidor; pedir de novo antes de uns 10 so gastaria exportacao a toa
const WARM_EVERY_MS = 10 * 60 * 1000;
// Ler os campos dos graficos nao pode travar a pergunta: passou disso, ela segue sem eles
const CONTEXT_TIMEOUT_MS = 8000;

/** O relatorio que a pessoa tem aberto em tela cheia. Quem o abre (ReportFullscreen) se registra aqui, e o
 * chat le a pagina ativa e os campos dos graficos so na hora de perguntar. */
export interface OpenReport {
  reportId: number;
  getPageName: () => Promise<string | null>;
  getContext: () => Promise<{ page_name: string; page_title: string; visuals: PageVisualInfo[] } | null>;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("tempo esgotado")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface ChatContextValue {
  canUse: boolean;
  accessLoading: boolean;
  conversations: Conversation[];
  activeId: number | null;
  items: ChatItem[];
  input: string;
  setInput: (value: string) => void;
  sending: boolean;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  /** Registra (ou, com null, tira) o relatorio aberto em tela cheia */
  setOpenReport: (report: OpenReport | null) => void;
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
  const [panelOpen, setPanelOpen] = useState(false);
  const [openReport, setOpenReport] = useState<OpenReport | null>(null);
  // Impede dois envios ao mesmo tempo mesmo antes de o estado "sending" chegar a tela
  const sendingRef = useRef(false);
  const lastWarmRef = useRef<{ key: string; at: number } | null>(null);

  // Pede ao servidor a imagem da pagina aberta, para as proximas perguntas. Nao espera nada e, se falhar
  // ou o admin nao tiver liberado imagens, a pergunta segue so com texto.
  async function warmImage() {
    if (!openReport) return;
    try {
      const pageName = await openReport.getPageName();
      if (!pageName) return;
      const key = `${openReport.reportId}:${pageName}`;
      const last = lastWarmRef.current;
      if (last && last.key === key && Date.now() - last.at < WARM_EVERY_MS) return;
      lastWarmRef.current = { key, at: Date.now() };
      await aiReportApi.warmPageImage(openReport.reportId, pageName);
    } catch {
      // sem imagem, a pergunta segue por texto
    }
  }

  // Chat aberto dentro de um relatorio: ja pede a imagem da pagina, que leva segundos para ficar pronta
  useEffect(() => {
    if (panelOpen && canUse && openReport) void warmImage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, canUse, openReport]);

  /** A pagina aberta e os campos dos graficos, se houver relatorio aberto. Falha ou demora so tira os campos:
   * o relatorio continua sendo informado, que ja ajuda a IA a escolher. */
  async function readOpenPage(): Promise<OpenPageInfo | undefined> {
    if (!openReport) return undefined;
    const base: OpenPageInfo = { report_id: openReport.reportId, page_name: null, page_title: null, visuals: [] };
    try {
      const context = await withTimeout(openReport.getContext(), CONTEXT_TIMEOUT_MS);
      return context ? { ...base, ...context } : base;
    } catch {
      return base;
    }
  }

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
      const openPage = await readOpenPage();
      void warmImage(); // para as proximas perguntas: a desta usa so a imagem que ja estiver pronta
      const response = openPage
        ? await chatApi.sendChatMessage(message, activeId ?? undefined, openPage)
        : await chatApi.sendChatMessage(message, activeId ?? undefined);
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
          usedImage: response.used_image === true,
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
        panelOpen,
        setPanelOpen,
        setOpenReport,
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

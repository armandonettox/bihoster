import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import * as chatApi from "../api/aiChat";
import type { Conversation } from "../api/aiChat";
import { extractErrorMessage } from "../api/client";
import { useAiAccess } from "../hooks/useAiAccess";
import { useToast } from "../context/ToastContext";
import ChatMessageView, { type ChatItem } from "../components/ChatMessageView";
import ConfirmDialog from "../components/ConfirmDialog";
import PageLoading from "../components/PageLoading";

const MAX_MESSAGE_CHARS = 4000;

let nextKey = 0;
const newKey = () => `m${nextKey++}`;

/** Chat global de IA: pergunta sobre os dados dos relatorios que a pessoa pode ver. As conversas ficam
 * no historico dela (so ela ve) e podem ser apagadas a qualquer hora. */
export default function ChatPage() {
  const { canUse, loading: accessLoading } = useAiAccess();
  const { showToast } = useToast();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Conversation | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  async function loadConversations() {
    try {
      setConversations(await chatApi.listConversations());
    } catch {
      showToast("Nao foi possivel carregar o historico.", "error");
    }
  }

  useEffect(() => {
    if (accessLoading || !canUse) return;
    let cancelled = false;
    chatApi
      .listConversations()
      .then((data) => {
        if (!cancelled) setConversations(data);
      })
      .catch(() => {
        if (!cancelled) showToast("Nao foi possivel carregar o historico.", "error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse, accessLoading]);

  // Mantem a ultima mensagem a vista
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, sending]);

  async function handleSend(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || sending) return;

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
      setSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envia; Shift+Enter quebra a linha
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  function newConversation() {
    setActiveId(null);
    setItems([]);
    setInput("");
    setListOpen(false);
  }

  async function openConversation(conversation: Conversation) {
    setListOpen(false);
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

  async function deleteOne(conversation: Conversation) {
    setConfirmDelete(null);
    try {
      await chatApi.deleteConversation(conversation.id);
      if (activeId === conversation.id) newConversation();
      await loadConversations();
      showToast("Conversa apagada.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel apagar a conversa.", "error");
    }
  }

  async function deleteAll() {
    setConfirmDeleteAll(false);
    try {
      await chatApi.deleteAllConversations();
      newConversation();
      setConversations([]);
      showToast("Historico apagado.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel apagar o historico.", "error");
    }
  }

  if (accessLoading) return <PageLoading />;

  if (!canUse) {
    return (
      <div className="chat-page-denied">
        <h1>Chat de IA</h1>
        <p>Voce nao tem permissao para usar o chat de IA. Peca a um administrador.</p>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <aside className={`chat-sidebar ${listOpen ? "chat-sidebar-open" : ""}`} aria-label="Conversas">
        <button type="button" className="btn btn-primary" onClick={newConversation}>
          Nova conversa
        </button>
        <ul className="chat-conversations">
          {conversations.map((conversation) => (
            <li
              key={conversation.id}
              className={`chat-conversation ${conversation.id === activeId ? "chat-conversation-active" : ""}`}
            >
              <button type="button" className="chat-conversation-open" onClick={() => openConversation(conversation)}>
                {conversation.title}
              </button>
              <button
                type="button"
                className="btn btn-ghost chat-conversation-delete"
                aria-label={`Apagar a conversa ${conversation.title}`}
                title="Apagar conversa"
                onClick={() => setConfirmDelete(conversation)}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  delete
                </span>
              </button>
            </li>
          ))}
          {conversations.length === 0 && <li className="chat-hint">Nenhuma conversa ainda.</li>}
        </ul>
        {conversations.length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmDeleteAll(true)}>
            Apagar todo o historico
          </button>
        )}
      </aside>

      <section className="chat-main" aria-label="Conversa">
        <div className="chat-header">
          <h1>Chat de IA</h1>
          <button type="button" className="btn btn-ghost chat-list-toggle" onClick={() => setListOpen((open) => !open)}>
            Conversas
          </button>
        </div>

        <div className="chat-messages" ref={messagesRef} aria-live="polite">
          {items.length === 0 && !sending && (
            <div className="chat-empty">
              <h2>Pergunte sobre os dados dos seus relatorios</h2>
              <p>
                Eu respondo so com base nos relatorios que voce pode ver. Cada resposta mostra de qual relatorio veio e a
                consulta usada. Relatorios com seguranca por linha (RLS) ainda nao sao consultados.
              </p>
            </div>
          )}
          {items.map((item) => (
            <ChatMessageView key={item.key} item={item} />
          ))}
          {sending && (
            <div className="chat-message chat-message-assistant">
              <div className="chat-bubble chat-pending">Pensando...</div>
            </div>
          )}
        </div>

        <form className="chat-form" onSubmit={handleSend}>
          <textarea
            className="input chat-input"
            aria-label="Sua pergunta"
            rows={2}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder="Escreva sua pergunta. Enter envia, Shift+Enter quebra a linha."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button type="submit" className="btn btn-primary" disabled={sending || !input.trim()}>
            Enviar
          </button>
        </form>
      </section>

      {confirmDelete && (
        <ConfirmDialog
          title="Apagar conversa"
          message={`Apagar a conversa "${confirmDelete.title}"? Isso nao pode ser desfeito.`}
          confirmLabel="Apagar"
          onConfirm={() => deleteOne(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmDeleteAll && (
        <ConfirmDialog
          title="Apagar todo o historico"
          message="Apagar todas as suas conversas do chat de IA? Isso nao pode ser desfeito."
          confirmLabel="Apagar tudo"
          onConfirm={deleteAll}
          onCancel={() => setConfirmDeleteAll(false)}
        />
      )}
    </div>
  );
}

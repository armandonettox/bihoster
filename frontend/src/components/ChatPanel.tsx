import { useEffect, type ChangeEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { useChat } from "../context/ChatContext";
import ChatThread from "./ChatThread";

/** Painel lateral do chat de IA: ocupa a metade da tela ao lado da pagina aberta (em celular, a tela toda).
 * Mostra a mesma conversa da pagina /chat. Na propria pagina /chat ele nao aparece, para nao duplicar. */
export default function ChatPanel() {
  const { canUse, accessLoading, panelOpen, setPanelOpen, conversations, activeId, loadConversations, newConversation, openConversation } =
    useChat();
  const location = useLocation();
  const visible = panelOpen && canUse && !accessLoading && location.pathname !== "/chat";

  useEffect(() => {
    if (visible) void loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  function handleSelect(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    if (value === "") {
      newConversation();
      return;
    }
    const conversation = conversations.find((c) => String(c.id) === value);
    if (conversation) void openConversation(conversation);
  }

  return (
    <aside className="chat-panel" aria-label="Chat de IA">
      <div className="chat-header">
        <h2 className="chat-panel-title">Chat de IA</h2>
        <div className="chat-panel-actions">
          <Link
            to="/chat"
            className="btn btn-ghost chat-panel-icon"
            title="Abrir em tela cheia"
            aria-label="Abrir em tela cheia"
            onClick={() => setPanelOpen(false)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              open_in_full
            </span>
          </Link>
          <button
            type="button"
            className="btn btn-ghost chat-panel-icon"
            title="Fechar o chat"
            aria-label="Fechar o chat"
            onClick={() => setPanelOpen(false)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>
      </div>
      <div className="chat-panel-bar">
        <select
          className="input chat-panel-select"
          aria-label="Conversa"
          value={activeId === null ? "" : String(activeId)}
          onChange={handleSelect}
        >
          <option value="">Nova conversa</option>
          {conversations.map((conversation) => (
            <option key={conversation.id} value={String(conversation.id)}>
              {conversation.title}
            </option>
          ))}
        </select>
      </div>
      <ChatThread />
    </aside>
  );
}

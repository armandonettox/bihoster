import { useEffect, useState } from "react";
import type { Conversation } from "../api/aiChat";
import { useChat } from "../context/ChatContext";
import ChatThread from "../components/ChatThread";
import ConfirmDialog from "../components/ConfirmDialog";
import PageLoading from "../components/PageLoading";

/** Chat global de IA: pergunta sobre os dados dos relatorios que a pessoa pode ver. As conversas ficam
 * no historico dela (so ela ve) e podem ser apagadas a qualquer hora. O estado da conversa fica no
 * ChatContext, para o painel lateral mostrar a mesma conversa. */
export default function ChatPage() {
  const {
    canUse,
    accessLoading,
    conversations,
    activeId,
    loadConversations,
    newConversation,
    openConversation,
    deleteConversation,
    deleteAllConversations,
  } = useChat();

  const [listOpen, setListOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Conversation | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  useEffect(() => {
    if (accessLoading || !canUse) return;
    void loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse, accessLoading]);

  function handleNew() {
    newConversation();
    setListOpen(false);
  }

  function handleOpen(conversation: Conversation) {
    setListOpen(false);
    void openConversation(conversation);
  }

  function handleDeleteOne(conversation: Conversation) {
    setConfirmDelete(null);
    void deleteConversation(conversation);
  }

  function handleDeleteAll() {
    setConfirmDeleteAll(false);
    void deleteAllConversations();
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
        <button type="button" className="btn btn-primary" onClick={handleNew}>
          Nova conversa
        </button>
        <ul className="chat-conversations">
          {conversations.map((conversation) => (
            <li
              key={conversation.id}
              className={`chat-conversation ${conversation.id === activeId ? "chat-conversation-active" : ""}`}
            >
              <button type="button" className="chat-conversation-open" onClick={() => handleOpen(conversation)}>
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

        <ChatThread />
      </section>

      {confirmDelete && (
        <ConfirmDialog
          title="Apagar conversa"
          message={`Apagar a conversa "${confirmDelete.title}"? Isso nao pode ser desfeito.`}
          confirmLabel="Apagar"
          onConfirm={() => handleDeleteOne(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmDeleteAll && (
        <ConfirmDialog
          title="Apagar todo o historico"
          message="Apagar todas as suas conversas do chat de IA? Isso nao pode ser desfeito."
          confirmLabel="Apagar tudo"
          onConfirm={handleDeleteAll}
          onCancel={() => setConfirmDeleteAll(false)}
        />
      )}
    </div>
  );
}

import { useLocation } from "react-router-dom";
import { useChat } from "../context/ChatContext";

/** Botao que abre e fecha o painel lateral do chat (barra superior do app e barra do relatorio em tela cheia).
 * So aparece para quem pode usar o chat, e nao na pagina /chat, que ja e o chat em tela cheia. */
export default function ChatPanelToggle({
  className = "btn btn-ghost",
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { canUse, panelOpen, setPanelOpen } = useChat();
  const location = useLocation();
  if (!canUse || location.pathname === "/chat") return null;

  const label = panelOpen ? "Fechar o chat lateral" : "Abrir o chat ao lado da pagina";
  return (
    <button
      type="button"
      className={className}
      onClick={() => setPanelOpen(!panelOpen)}
      aria-pressed={panelOpen}
      title={label}
      aria-label={label}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden="true">
        {panelOpen ? "chat_bubble" : "chat"}
      </span>
      {showLabel && <span>Chat</span>}
    </button>
  );
}

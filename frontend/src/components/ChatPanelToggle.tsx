import { useLocation } from "react-router-dom";
import { useChat } from "../context/ChatContext";

/** Botao da barra superior que abre e fecha o painel lateral do chat. So aparece para quem pode usar o chat,
 * e nao na pagina /chat, que ja e o chat em tela cheia. */
export default function ChatPanelToggle() {
  const { canUse, panelOpen, setPanelOpen } = useChat();
  const location = useLocation();
  if (!canUse || location.pathname === "/chat") return null;

  const label = panelOpen ? "Fechar o chat lateral" : "Abrir o chat ao lado da pagina";
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() => setPanelOpen(!panelOpen)}
      aria-pressed={panelOpen}
      title={label}
      aria-label={label}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden="true">
        {panelOpen ? "chat_bubble" : "chat"}
      </span>
    </button>
  );
}
